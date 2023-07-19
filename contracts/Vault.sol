//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./libraries/SafeDecimalMath.sol";
import "./libraries/SignedSafeDecimalMath.sol";
import "./utils/Timestamp.sol";
import "./Ledger.sol";
import "./OptionMarket.sol";
import "./SpotPricer.sol";
import "./Config.sol";
import "./interfaces/IOptionPricer.sol";
import "./interfaces/IVault.sol";

contract Vault is IVault, Ledger, Timestamp {
  using SafeDecimalMath for uint;
  using SignedSafeDecimalMath for int;
  using SafeERC20 for IERC20;

  enum FundType { Trade, Deposit, Withdraw, Settle, Liquidate, Clear, Dust }

  error AlreadyInitialized();
  error ZeroAmount(uint index);
  error InvalidRate();
  error InvalidFreeWithdrawableRate();
  error UnacceptableAmount();
  error InsufficientEquity(uint index);
  error WithdrawTooMuch();
  error Unavailable(uint index);
  error InvalidSize(uint index);
  error InvalidTime(uint index);
  error TradeDisabled();
  error IvOutdated();
  error ZeroPrice();
  error UnacceptablePrice();
  error Unsettled();
  error ZeroPosition();
  error CannotLiquidate();
  error SellPositionFirst();
  error InvalidAccount();
  error CannotClear();
  error NotOwner();

  struct PositionInfo {
    int buyNotional;
    int buyValue;
    int unsettledSellSize;
    int sellNotional;
    int sellValue;
    uint settledRisk;
    int fee;
  }

  struct UpdatePositionInfo {
    int remainSize;
    int remainNotional;
    int remainFee;
    bool allClose;
  }

  struct RemovePositions {
    PositionParams[50] sellPositions;
    uint sellLength;
    PositionParams[50] buyPositions;
    uint buyLength;
    bool morePositions;
  }

  struct ReducePositionParams {
    address account;
    uint amountToRemove;
    int sizeChange;
    int amountChange;
    int platformFee;
    bool done;
    bool removeAll;
  }

  struct LiquidateInfo {
    uint clearRate;
    uint liquidateRate;
    uint liquidationReward;
    int marginBalance;
    uint maxLiquidation;
    int healthFactor;
  }

  struct SettleInfo {
    int realized;
    int fee;
  }

  Config public config;
  SpotPricer public spotPricer;
  IOptionPricer public optionPricer;
  OptionMarket public optionMarket;
  bool public initialized;
  address public owner;

  // 57896044618658097711785492504343953926634992332820282019728792003956564819967
  int256 internal constant INT256_MAX = int256((uint256(1) << 255) - 1);
  int internal constant OTM_WEIGHT = 10**40;
  int internal constant EXPIRY_WEIGHT = 10**28;
  uint internal constant OUTDATED_PERIOD = 1 hours;
  uint internal constant MAX_REMOVE_POSITION = 50;

  event Fund(address account, int amount, FundType fundType);

  function initialize(address _config, address _spotPricer, address _optionPricer, address _optionMarket) external {
    if (initialized) {
      revert AlreadyInitialized();
    }
    initialized = true;
    owner = msg.sender;
    setAddresses(_config, _spotPricer, _optionPricer, _optionMarket);
  }

  function checkOwner() internal view {
    if (msg.sender != owner) {
      revert NotOwner();
    }
  }

  function setAddresses(address _config, address _spotPricer, address _optionPricer, address _optionMarket) public {
    checkOwner();
    config = Config(_config);
    spotPricer = SpotPricer(_spotPricer);
    optionPricer = IOptionPricer(_optionPricer);
    optionMarket = OptionMarket(_optionMarket);
  }

  function changeOwner(address _owner) external {
    checkOwner();
    owner = _owner;
  }

  function deposit(uint amount) external {
    amount = amount.truncate(config.quoteDecimal());
    if (amount == 0) {
      revert ZeroAmount(0);
    }
    transferFrom(msg.sender, address(this), amount);
    updateBalance(msg.sender, int(amount), FundType.Deposit);
  }

  function withdraw(uint amount) public {
    if (amount == 0) {
      revert ZeroAmount(1);
    }
    int available = internalGetAvailable(initTxCache(), msg.sender);
    if (int(amount) > available) {
      amount = available < 0 ? 0 : uint(available);
    }
    if (amount == 0) {
      revert ZeroAmount(2);
    }
    updateBalance(msg.sender, -int(amount), FundType.Withdraw);
    collectDust(amount);
    transfer(msg.sender, amount);
  }

  function withdrawPercent(uint rate, uint acceptableAmount, uint freeWithdrawableRate) public returns (uint) {
    if (rate == 0 || rate > SafeDecimalMath.UNIT) {
      revert InvalidRate();
    }
    if (freeWithdrawableRate > SafeDecimalMath.UNIT) {
      revert InvalidFreeWithdrawableRate();
    }
    int amount = internalWithdrawPercent(msg.sender, rate, freeWithdrawableRate);
    if (amount <= 0) {
      revert ZeroAmount(3);
    }
    if (uint(amount) < acceptableAmount) {
      revert UnacceptableAmount();
    }
    updateBalance(msg.sender, -amount, FundType.Withdraw);
    collectDust(uint(amount));
    transfer(msg.sender, uint(amount));
    return uint(amount);
  }

  function collectDust(uint amount) private {
    amount -= amount.truncate(config.quoteDecimal());
    if (amount > 0) {
      chargeFee(int(amount), FundType.Dust);
    }
  }

  function transfer(address to, uint amount) private {
    IERC20(config.quote()).safeTransfer(to, (amount * 10**config.quoteDecimal()) / SafeDecimalMath.UNIT);
  }

  function transferFrom(address from, address to, uint amount) private {
    IERC20(config.quote()).safeTransferFrom(from, to, (amount * 10**config.quoteDecimal()) / SafeDecimalMath.UNIT);
  }

  function internalWithdrawPercent(address account, uint rate, uint freeWithdrawableRate) private returns (int) {
    TxCache memory txCache = initTxCache();
    PositionInfo memory positionInfo = getPositionInfo(txCache, account);
    AccountInfo memory accountInfo = internalGetAccountInfoWithPositionInfo(positionInfo, txCache, account);
    if (accountInfo.equity <= 0) {
      revert InsufficientEquity(0);
    }

    int expectToWithdrawAmount = accountInfo.equity.decimalMul(int(rate));
    int freeWithdrawableAmount = 0;
    if (freeWithdrawableRate > 0) {
      uint reservedRate = config.poolReservedRate(account);
      int reserved = accountInfo.marginBalance.decimalMul(int(reservedRate));
      int adjustedAvailable = accountInfo.available - reserved;
      int adjustedEquity = accountInfo.equity - reserved;
      int maxFreeWithdrawableAmount = adjustedEquity - (adjustedEquity - adjustedAvailable).decimalDiv(int(freeWithdrawableRate));
      if (reservedRate < SafeDecimalMath.UNIT) {
        maxFreeWithdrawableAmount = maxFreeWithdrawableAmount.decimalDiv(int(SafeDecimalMath.UNIT - reservedRate));
      } else {
        maxFreeWithdrawableAmount = 0;
      }
      freeWithdrawableAmount = expectToWithdrawAmount > maxFreeWithdrawableAmount ? maxFreeWithdrawableAmount : expectToWithdrawAmount;
      if (freeWithdrawableAmount > 0) {
        accountInfo.equity -= freeWithdrawableAmount;
        accountInfo.available -= freeWithdrawableAmount;
      } else {
        freeWithdrawableAmount = 0;
      }
    }
    if (expectToWithdrawAmount > freeWithdrawableAmount) {
      return reducePosition(account, expectToWithdrawAmount - freeWithdrawableAmount, txCache, positionInfo, accountInfo);
    } else {
      return freeWithdrawableAmount;
    }
  }

  function reducePosition(address account, int amountToRemove, TxCache memory txCache, PositionInfo memory positionInfo, AccountInfo memory accountInfo) private returns (int) {
    uint rate = uint(amountToRemove.decimalDivRound(accountInfo.equity));
    // sell position risk
    uint ratedRisk = accountInfo.initialMargin - uint(-positionInfo.sellValue);
    uint riskDenominator = ratedRisk + uint(positionInfo.buyValue);
    // total risk want to remove
    uint riskDenominatorToRemove = riskDenominator.decimalMul(rate);
    RemovePositions memory removePositions = getPositions(txCache, account, MAX_REMOVE_POSITION, true);
    ReducePositionParams memory reducePositionParams = ReducePositionParams(
      account,
      riskDenominatorToRemove > ratedRisk ? ratedRisk : riskDenominatorToRemove,
      0,
      0,
      0,
      false,
      rate == SafeDecimalMath.UNIT
    );
    if (reducePositionParams.amountToRemove > 0) {
      reducePositionSub(reducePositionParams, txCache, removePositions, false);
    }

    // more than sell risk, may remove buy position
    if (riskDenominatorToRemove > ratedRisk) {
      accountInfo.available = balanceOf[account] + positionInfo.buyNotional;

      // only remove position when available isn't enough
      if (amountToRemove > accountInfo.available || reducePositionParams.removeAll) {
        reducePositionParams.amountToRemove = reducePositionParams.removeAll ? 0 : uint(amountToRemove - accountInfo.available);
        reducePositionParams.done = false;
        reducePositionSub(reducePositionParams, txCache, removePositions, true);
      }
    }
    chargeFee(reducePositionParams.platformFee, FundType.Trade);
    // actual remain - expect remain
    return internalGetAccountInfo(txCache, account).equity - (accountInfo.equity - amountToRemove);
  }

  function reducePositionSub(ReducePositionParams memory reducePositionParams, TxCache memory txCache, RemovePositions memory removePositions, bool isBuy) private {
    PositionParams[50] memory positions;
    uint length;
    if (isBuy) {
      positions = removePositions.buyPositions;
      length = removePositions.buyLength;
    } else {
      positions = removePositions.sellPositions;
      length = removePositions.sellLength;
    }
    quickSort(positions, 0, int(length) - 1);

    for (int i = int(length) - 1; i >= 0; --i) {
      PositionParams memory position = positions[uint(i)];
      reduceTradeTypePosition(reducePositionParams, position, txCache);
      if (reducePositionParams.removeAll) {
        continue;
      }
      if (reducePositionParams.done) {
        return;
      }
      uint removedAmount = isBuy ? uint(reducePositionParams.amountChange) : uint(reducePositionParams.sizeChange).decimalMul(txCache.spotInitialMarginRiskRate);
      if (removedAmount >= reducePositionParams.amountToRemove) {
        return;
      }
      reducePositionParams.amountToRemove -= removedAmount;
    }
    if (!reducePositionParams.removeAll || removePositions.morePositions) {
      revert WithdrawTooMuch();
    }
  }

  function reduceTradeTypePosition(ReducePositionParams memory reducePositionParams, PositionParams memory position, TxCache memory txCache) private {
    reducePositionParams.sizeChange = 0;
    int size = position.size;
    bool isBuy = size > 0;
    if (!reducePositionParams.removeAll && !isBuy) {
      uint ratedRisk = uint(-size).decimalMul(txCache.spotInitialMarginRiskRate);
      if (reducePositionParams.amountToRemove < ratedRisk) {
        size = size.decimalMulRoundUp(int(reducePositionParams.amountToRemove)).decimalDivRoundUp(int(ratedRisk));
        reducePositionParams.done = true;
      }
    }
    position.size = -size;
    TradingPoolsInfo memory tradingPoolsInfo = getTradingPoolsInfo(txCache, position, true, reducePositionParams.account);
    int closePremium = 0;
    int closeFee = 0;
    if (tradingPoolsInfo.totalSize.abs() < size.abs()) {
      if (tradingPoolsInfo.totalSize != 0) {
        int tradedSize;
        (closePremium, closeFee, tradedSize) = reduceTradeTypePositionSub(reducePositionParams, position, txCache, 0, isBuy, tradingPoolsInfo.totalSize, tradingPoolsInfo);
        if (isBuy && reducePositionParams.done) {
          size = 0;
        } else {
          size -= -tradedSize;
        }
        position.size = -size;
      }
      if (size != 0) {
        tradingPoolsInfo = getTradingPoolsInfo(txCache, position, false, reducePositionParams.account);
      }
    }

    int premium = 0;
    int fee = 0;
    if (size != 0) {
      (premium, fee, ) = reduceTradeTypePositionSub(reducePositionParams, position, txCache, isBuy ? uint(closePremium + closeFee) : 0, isBuy, -size, tradingPoolsInfo);
      if (!tradingPoolsInfo.isClose) {
        if (tradingPoolsInfo.totalAdjustedAvailable < 0) {
          revert Unavailable(0);
        }
      }
    }
    reducePositionParams.amountChange = premium + closePremium;
    reducePositionParams.sizeChange = internalUpdatePosition(
      reducePositionParams.account, position.expiry, position.strike, position.isCall, reducePositionParams.sizeChange, reducePositionParams.amountChange, fee + closeFee, ChangeType.Trade
    );
    reducePositionParams.amountChange += fee + closeFee;
  }

  function reduceTradeTypePositionSub(ReducePositionParams memory reducePositionParams, PositionParams memory position, TxCache memory txCache, uint removingAmount, bool isBuy, int size, TradingPoolsInfo memory tradingPoolsInfo) private returns (int, int, int) {
    (int premium, int fee) = internalGetPremium(txCache, position.expiry, position.strike, position.isCall, size, tradingPoolsInfo.isClose ? INT256_MAX : tradingPoolsInfo.totalAvailable, tradingPoolsInfo.totalEquity);
    if (!reducePositionParams.removeAll && isBuy && reducePositionParams.amountToRemove - removingAmount < uint(premium + fee)) {
      size = size.decimalMulRoundUp(int(reducePositionParams.amountToRemove - removingAmount)).decimalDivRoundUp(premium + fee);
      (premium, fee) = internalGetPremium(txCache, position.expiry, position.strike, position.isCall, size, tradingPoolsInfo.isClose ? INT256_MAX : tradingPoolsInfo.totalAvailable, tradingPoolsInfo.totalEquity);
      reducePositionParams.done = true;
    }
    reducePositionParams.sizeChange += size;

    position.size = -size;
    position.notional = -premium;
    reducePositionParams.platformFee += internalPoolUpdatePosition(position, txCache, tradingPoolsInfo, -fee);
    return (premium, fee, size);
  }

  function quickSort(PositionParams[50] memory arr, int left, int right) private view {
    int i = left;
    int j = right;
    if (i == j) {
      return;
    }
    int pivot = arr[uint(left + (right - left) / 2)].notional;
    while (i <= j) {
      while (arr[uint(i)].notional < pivot) {
        i++;
      }
      while (pivot < arr[uint(j)].notional) {
        j--;
      }
      if (i <= j) {
        (arr[uint(i)], arr[uint(j)]) = (arr[uint(j)], arr[uint(i)]);
        i++;
        j--;
      }
    }
    if (left < j) {
      quickSort(arr, left, j);
    }
    if (i < right) {
      quickSort(arr, i, right);
    }
  }

  function getPositions(TxCache memory txCache, address account, uint maxLength, bool checkDisable) private view returns (RemovePositions memory removePositions) {
    uint[] memory expiries = listOfExpiries(account);
    if (checkDisable && (optionMarket.tradeDisabled() || isIvOutdated(txCache.now))) {
      removePositions.morePositions = expiries.length != 0;
      return removePositions;
    }
    for (uint i = 0; i < expiries.length; ++i) {
      uint expiry = expiries[i];
      if (checkDisable && (txCache.now >= expiry || optionMarket.expiryDisabled(expiry))) {
        removePositions.morePositions = true;
        continue;
      }
      uint[] memory strikes = listOfStrikes(account, expiry);
      for (uint j = 0; j < strikes.length; ++j) {
        uint strike = strikes[j];
        pushPosition(txCache, account, expiry, strike, true, maxLength, removePositions, checkDisable);
        pushPosition(txCache, account, expiry, strike, false, maxLength, removePositions, checkDisable);
        if (removePositions.buyLength == maxLength && removePositions.sellLength == maxLength) {
          if (removePositions.morePositions) {
            return removePositions;
          } else {
            continue;
          }
        }
      }
    }
  }

  function pushPosition(TxCache memory txCache, address account, uint expiry, uint strike, bool isCall, uint maxLength, RemovePositions memory removePositions, bool checkDisable) internal view {
    int size = positionSizeOf(account, expiry, strike, isCall);
    if (size > 0) {
      if (checkDisable && isMarketDisabled(txCache, expiry, strike ,isCall, false)) {
        removePositions.morePositions = true;
      } else if (removePositions.buyLength < maxLength) {
        removePositions.buyPositions[removePositions.buyLength++] = PositionParams(
          expiry, strike, isCall, size, size
        );
      } else if (!removePositions.morePositions) {
        removePositions.morePositions = true;
      }
    } else if (size < 0) {
      if (checkDisable && isMarketDisabled(txCache, expiry, strike ,isCall, true)) {
        removePositions.morePositions = true;
      } else if (removePositions.sellLength < maxLength) {
        // priority: otm, expiry, S-K
        int weight = isCall ? int(strike) - int(txCache.spot) : int(txCache.spot) - int(strike);
        if (weight > 0) {
          weight += OTM_WEIGHT;
        }
        weight += (10**11 - int(expiry)) * EXPIRY_WEIGHT;
        removePositions.sellPositions[removePositions.sellLength++] = PositionParams(
          expiry, strike, isCall, size, weight
        );
      } else if (!removePositions.morePositions) {
        removePositions.morePositions = true;
      }
    }
  }

  function internalPoolUpdatePosition(PositionParams memory positionParams, TxCache memory txCache, TradingPoolsInfo memory tradingPoolsInfo, int fee) internal virtual returns (int) {
    int poolFee = fee.decimalMul(int(txCache.poolProportion));
    uint length = tradingPoolsInfo.length;
    UpdatePositionInfo memory info = UpdatePositionInfo(positionParams.size, positionParams.notional, poolFee, tradingPoolsInfo.totalSize == -positionParams.size);
    int sellSizeChange;
    int notional;
    int subFee;
    uint index;
    for (uint i = 0; i < length - 1; i++) {
      index = tradingPoolsInfo.indexes[i];
      (sellSizeChange, notional, subFee) = internalUpdatePositionSub(positionParams, txCache.pools[index], tradingPoolsInfo.rates[index], poolFee, info);
      updateAvailableCache(tradingPoolsInfo, txCache, index, sellSizeChange, notional, subFee);
      if (info.remainSize == 0) {
        break;
      }
    }
    if (info.remainSize != 0) {
      index = tradingPoolsInfo.indexes[length - 1];
      notional = info.remainNotional;
      subFee = info.remainFee;
      sellSizeChange = internalUpdatePosition(
        txCache.pools[index], positionParams.expiry, positionParams.strike, positionParams.isCall, info.remainSize, info.remainNotional, info.remainFee, ChangeType.Trade
      );
      updateAvailableCache(tradingPoolsInfo, txCache, index, sellSizeChange, notional, subFee);
    }
    return fee - poolFee;
  }

  function internalUpdatePositionSub(PositionParams memory positionParams, address account, int rate, int fee, UpdatePositionInfo memory info) private returns (int sellSizeChange, int notional, int subFee) {
    if (info.allClose) {
      sellSizeChange = -positionSizeOf(account, positionParams.expiry, positionParams.strike, positionParams.isCall);
    } else if (rate != 0) {
      sellSizeChange = positionParams.size.decimalMul(rate);
    }
    if (sellSizeChange == 0) {
      return (sellSizeChange, notional, subFee);
    }
    notional = positionParams.notional.decimalMul(rate);
    subFee = fee.decimalMul(rate);
    info.remainSize -= sellSizeChange;
    info.remainNotional -= notional;
    info.remainFee -= subFee;
    sellSizeChange = internalUpdatePosition(
      account, positionParams.expiry, positionParams.strike, positionParams.isCall, sellSizeChange, notional, subFee, ChangeType.Trade
    );
  }

  // inaccurate
  function updateAvailableCache(TradingPoolsInfo memory tradingPoolsInfo, TxCache memory txCache, uint index, int sellSizeChange, int notional, int fee) private pure {
    int availableChange = (sellSizeChange != 0 ? sellSizeChange.decimalMul(int(txCache.spotInitialMarginRiskRate)) : notional) + fee;
    txCache.equity[index] += fee;
    txCache.available[index] += availableChange;
    txCache.adjustedAvailable[index] += availableChange;
    tradingPoolsInfo.totalAdjustedAvailable += availableChange;
  }

  function getAccountInfo(address account) external view returns (AccountInfo memory accountInfo) {
    return internalGetAccountInfo(initTxCache(), account);
  }

  function internalGetAccountInfo(TxCache memory txCache, address account) private view returns (AccountInfo memory accountInfo) {
    return internalGetAccountInfoWithPositionInfo(getPositionInfo(txCache, account), txCache, account);
  }

  function getPositionInitialMargin(PositionInfo memory positionInfo, uint spot, uint initialMarginRiskRate) private pure returns (uint) {
    return (uint(-positionInfo.unsettledSellSize).decimalMul(spot) + positionInfo.settledRisk).decimalMul(initialMarginRiskRate) + uint(-positionInfo.sellValue);
  }

  function internalGetAccountInfoWithPositionInfo(PositionInfo memory positionInfo, TxCache memory txCache, address account) private view returns (AccountInfo memory accountInfo) {
    accountInfo.marginBalance = int(balanceOf[account]) + positionInfo.buyNotional + positionInfo.sellNotional;
    accountInfo.equity = accountInfo.marginBalance + positionInfo.buyValue + positionInfo.sellValue;
    accountInfo.equityWithFee = accountInfo.equity + positionInfo.fee;
    accountInfo.initialMargin = getPositionInitialMargin(positionInfo, txCache.spot, txCache.initialMarginRiskRate);
    accountInfo.upnl = positionInfo.buyNotional + positionInfo.buyValue + positionInfo.sellNotional + positionInfo.sellValue;
    accountInfo.available = accountInfo.marginBalance - int(accountInfo.initialMargin);

    int riskDenominator = int(accountInfo.initialMargin) + positionInfo.buyValue + positionInfo.sellValue;
    accountInfo.healthFactor = riskDenominator == 0 ? INT256_MAX : accountInfo.equity.decimalDiv(riskDenominator);
  }

  function internalGetAvailable(TxCache memory txCache, address account) private view returns (int) {
    return internalGetAccountInfo(txCache, account).available;
  }

  function getPositionInfo(TxCache memory txCache, address account) private view returns (PositionInfo memory positionInfo) {
    uint[] memory expiries = listOfExpiries(account);
    PositionParams memory positionParams;
    for (uint i = 0; i < expiries.length; ++i) {
      positionParams.expiry = expiries[i];
      uint settledPrice = txCache.now >= positionParams.expiry ? spotPricer.settledPrices(positionParams.expiry) : 0;
      uint[] memory strikes = listOfStrikes(account, positionParams.expiry);
      for (uint j = 0; j < strikes.length; ++j) {
        positionParams.strike = strikes[j];
        getPositionInfoSub(txCache, account, settledPrice, positionParams, positionInfo, true);
        getPositionInfoSub(txCache, account, settledPrice, positionParams, positionInfo, false);
      }
    }
  }

  function getPositionInfoSub(TxCache memory txCache, address account, uint settledPrice, PositionParams memory positionParams, PositionInfo memory positionInfo, bool isCall) private view {
    int size = positionSizeOf(account, positionParams.expiry, positionParams.strike, isCall);
    if (size == 0 ) {
      return;
    }
    positionParams.size = size;
    positionParams.isCall = isCall;
    (int notional, int value, int fee) = getTradeTypeInfo(txCache, account, positionParams, settledPrice);
    positionInfo.fee += fee;
    if (size > 0) {
      positionInfo.buyNotional += notional;
      positionInfo.buyValue += value;
    } else {
      if (settledPrice == 0) {
        positionInfo.unsettledSellSize += size;
      } else {
        positionInfo.settledRisk += uint(-size).decimalMul(settledPrice);
      }
      positionInfo.sellNotional += notional;
      positionInfo.sellValue += value;
    }
  }

  function getTradeTypeInfo(TxCache memory txCache, address account, PositionParams memory positionParams, uint settledPrice) private view returns (int notional, int value, int fee) {
    notional = accountPositions[account][positionParams.expiry][positionParams.strike][positionParams.isCall].notional;
    (value, fee) = txCache.now >= positionParams.expiry ?
      getTradeTypeSettledValue(txCache.exerciseFeeRate, txCache.profitFeeRate, positionParams.strike, settledPrice == 0 ? txCache.spot :
      settledPrice, positionParams.isCall, positionParams.size) : internalGetPremium(txCache, positionParams.expiry, positionParams.strike, positionParams.isCall, -positionParams.size, INT256_MAX, 0);
  }

  function getTradeTypeSettledValue(uint exerciseFeeRate, uint profitFeeRate, uint strike, uint settledPrice, bool isCall, int size) private pure returns (int value, int fee) {
    if (isCall) {
      if (settledPrice > strike) {
        value = int(settledPrice - strike).decimalMul(size);
      }
    } else {
      if (settledPrice < strike) {
        value = int(strike - settledPrice).decimalMul(size);
      }
    }
    if (value != 0) {
      fee = int(settledPrice.decimalMul(exerciseFeeRate));
      int fee2 = int(value.abs().decimalMul(profitFeeRate));
      if (fee2 < fee) {
        fee = fee2;
      }
      fee = -fee;
    }
  }

  function initTxCache() internal view virtual returns (TxCache memory txCache) {
    address[] memory pools = config.getPools();
    txCache.poolLength = pools.length;
    // txCache.spot = spotPricer.getPrice();
    txCache.spot = getSpotPrice();
    txCache.initialMarginRiskRate = config.initialMarginRiskRate();
    txCache.spotInitialMarginRiskRate = txCache.spot.decimalMul(txCache.initialMarginRiskRate);
    txCache.priceRatio = config.priceRatio();
    txCache.priceRatio2 = config.priceRatio2();
    txCache.priceRatioUtilization = config.priceRatioUtilization();
    txCache.spotFee = config.spotFee();
    txCache.optionFee = config.optionFee();
    txCache.minPremium = config.minPremium();
    txCache.exerciseFeeRate = config.exerciseFeeRate();
    txCache.profitFeeRate = config.profitFeeRate();
    txCache.poolProportion = config.poolProportion();
    txCache.now = getTimestamp();
    txCache.riskFreeRate = config.riskFreeRate();
    for (uint i = 0; i < txCache.poolLength; ++i) {
      txCache.pools[i] = pools[i];
    }
  }

  function getTradingPoolsInfo(TxCache memory txCache, PositionParams memory positionParams, bool isClose, address excludedPool) private view returns(TradingPoolsInfo memory tradingPoolsInfo) {
    bool isBuy = positionParams.size > 0;
    tradingPoolsInfo.isClose = isClose;
    for (uint i = 0; i < txCache.poolLength; ++i) {
      address pool = txCache.pools[i];
      if (excludedPool == pool) {
        continue;
      }

      if (isClose) {
        int size = positionSizeOf(pool, positionParams.expiry, positionParams.strike, positionParams.isCall);
        if (!(isBuy && size > 0 || !isBuy && size < 0)) {
          continue;
        }
        tradingPoolsInfo.rates[i] = size;
        tradingPoolsInfo.totalSize += size;
      } else {
        if (!txCache.loaded[i]) {
          AccountInfo memory accountInfo = internalGetAccountInfo(txCache, pool);
          uint reservedRate = config.poolReservedRate(pool);
          txCache.available[i] = accountInfo.available;
          txCache.adjustedAvailable[i] = accountInfo.available - accountInfo.marginBalance.decimalMul(int(reservedRate));
          txCache.equity[i] = accountInfo.equity;
          txCache.loaded[i] = true;
        }
        if (txCache.adjustedAvailable[i] > 0) {
          tradingPoolsInfo.rates[i] = txCache.adjustedAvailable[i];
          tradingPoolsInfo.totalAvailable += txCache.available[i];
          tradingPoolsInfo.totalAdjustedAvailable += txCache.adjustedAvailable[i];
        }
        tradingPoolsInfo.totalEquity += txCache.equity[i];
      }
      if (tradingPoolsInfo.rates[i] != 0) {
        tradingPoolsInfo.indexes[tradingPoolsInfo.length++] = i;
      }
    }

    if (tradingPoolsInfo.length > 0) {
      int remaining = SignedSafeDecimalMath.UNIT;
      int base = isClose ? tradingPoolsInfo.totalSize : tradingPoolsInfo.totalAdjustedAvailable;
      uint index;
      for (uint i = 0; i < tradingPoolsInfo.length - 1; ++i) {
        index = tradingPoolsInfo.indexes[i];
        tradingPoolsInfo.rates[index] = tradingPoolsInfo.rates[index].decimalDivRound(base);
        remaining -= tradingPoolsInfo.rates[index];
      }
      index = tradingPoolsInfo.indexes[tradingPoolsInfo.length - 1];
      tradingPoolsInfo.rates[index] = remaining;
    }
  }

  function trade(uint expiry, uint strike, bool isCall, int size, uint acceptableTotal) public {
    if (size == 0) {
      revert InvalidSize(0);
    }
    if (getTimestamp() >= expiry) {
      revert InvalidTime(0);
    }

    TxCache memory txCache = initTxCache();
    if (isIvOutdated(txCache.now)) {
      revert IvOutdated();
    }
    if (optionMarket.tradeDisabled() || optionMarket.expiryDisabled(expiry) || isMarketDisabled(txCache, expiry, strike ,isCall, size > 0)) {
      revert TradeDisabled();
    }

    int premium = 0;
    int fee = 0;
    int closePremium = 0;
    int closeFee = 0;
    int platformFee = 0;
    {
      PositionParams memory positionParams = PositionParams(expiry, strike, isCall, size, 0);
      TradingPoolsInfo memory tradingPoolsInfo = getTradingPoolsInfo(txCache, positionParams, true, msg.sender);
      {
        int remainSize = size;
        if (tradingPoolsInfo.totalSize.abs() < size.abs()) {
          if (tradingPoolsInfo.totalSize != 0) {
            (closePremium, closeFee) = internalGetPremium(txCache, expiry, strike, isCall, tradingPoolsInfo.totalSize, INT256_MAX, 0);
            positionParams.size = -tradingPoolsInfo.totalSize;
            positionParams.notional = -closePremium;
            platformFee = internalPoolUpdatePosition(positionParams, txCache, tradingPoolsInfo, -closeFee);
            remainSize -= tradingPoolsInfo.totalSize;
            positionParams.size = size;
          }
          tradingPoolsInfo = getTradingPoolsInfo(txCache, positionParams, false, msg.sender);
        }
        (premium, fee) = internalGetPremium(txCache, expiry, strike, isCall, remainSize, tradingPoolsInfo.isClose ? INT256_MAX : tradingPoolsInfo.totalAvailable, tradingPoolsInfo.totalEquity);
        positionParams.size = -remainSize;
        positionParams.notional = -premium;
        platformFee += internalPoolUpdatePosition(positionParams, txCache, tradingPoolsInfo, -fee);
      }
      {
        int total = premium + closePremium + fee + closeFee;
        if (!tradingPoolsInfo.isClose) {
          if (tradingPoolsInfo.totalAdjustedAvailable < 0) {
            revert Unavailable(1);
          }
          if (size > 0 ? total >= 0 : total <= 0) {
            revert ZeroPrice();
          }
        }
        if (total < (size > 0 ? -int(acceptableTotal) : int(acceptableTotal))) {
          revert UnacceptablePrice();
        }
      }
      bool isTraderClosing = traderClosing(msg.sender, expiry, strike, isCall, size);
      internalUpdatePosition(
        msg.sender, expiry, strike, isCall, size, premium + closePremium, fee + closeFee, ChangeType.Trade
      );
      if (!isTraderClosing && internalGetAvailable(txCache, msg.sender) < 0) {
        revert Unavailable(2);
      }
    }
    chargeFee(platformFee, FundType.Trade);
  }

  function getPremium(uint expiry, uint strike, bool isCall, int size) external view returns (int, int) {
    TxCache memory txCache = initTxCache();
    if (txCache.now >= expiry) {
      uint settledPrice = spotPricer.settledPrices(expiry);
      return getTradeTypeSettledValue(txCache.exerciseFeeRate, txCache.profitFeeRate, strike, settledPrice == 0 ? txCache.spot : settledPrice, isCall, -size);
    } else {
      PositionParams memory positionParams = PositionParams(expiry, strike, isCall, size, 0);
      TradingPoolsInfo memory tradingPoolsInfo = getTradingPoolsInfo(txCache, positionParams, true, address(0));
      int closePremium = 0;
      int closeFee = 0;
      int remainSize = size;
      if (tradingPoolsInfo.totalSize.abs() < size.abs()) {
        if (tradingPoolsInfo.totalSize != 0) {
          (closePremium, closeFee) = internalGetPremium(txCache, expiry, strike, isCall, tradingPoolsInfo.totalSize, INT256_MAX, 0);
          remainSize -= tradingPoolsInfo.totalSize;
        }
        tradingPoolsInfo = getTradingPoolsInfo(txCache, positionParams, false, address(0));
        tradingPoolsInfo.totalAvailable -= closePremium + closeFee;
        tradingPoolsInfo.totalEquity -= closeFee;
      }
      (int premium, int fee) = internalGetPremium(txCache, expiry, strike, isCall, remainSize, tradingPoolsInfo.isClose ? INT256_MAX : tradingPoolsInfo.totalAvailable, tradingPoolsInfo.totalEquity);
      return (premium + closePremium, fee + closeFee);
    }
  }

  function internalGetPremium(TxCache memory txCache, uint expiry, uint strike, bool isCall, int size, int available, int equity) private view returns (int, int) {
    return optionPricer.getPremium(IOptionPricer.GetPremiumParams(
      txCache.now,
      txCache.spot,
      txCache.riskFreeRate,
      txCache.initialMarginRiskRate,
      txCache.spotFee,
      txCache.optionFee,
      txCache.minPremium,
      expiry,
      strike,
      getIv(txCache, expiry, strike, isCall, size > 0),
      size,
      available,
      equity,
      txCache.priceRatio,
      txCache.priceRatio2,
      txCache.priceRatioUtilization,
      isCall
    ));
  }

  function traderClosing(address account, uint expiry, uint strike, bool isCall, int size) internal view returns (bool) {
    int positionSize = positionSizeOf(account, expiry, strike, isCall);
    if (positionSize > 0 && size < 0 || positionSize < 0 && size > 0) {
      return size.abs() <= positionSize.abs();
    } else {
      return false;
    }
  }

  function getIv(TxCache memory /* txCache */, uint expiry, uint strike, bool isCall, bool isBuy) internal view virtual returns (uint) {
    return optionMarket.getMarketIv(expiry, strike, isCall, isBuy);
  }

  function settle(address account, uint expiry) public {
    if (getTimestamp() < expiry) {
      revert InvalidTime(1);
    }

    uint settledPrice = spotPricer.settledPrices(expiry);
    if (settledPrice == 0) {
      revert Unsettled();
    }

    SettleInfo memory settleInfo = settleExpiry(settledPrice, account, expiry);
    if (settleInfo.realized + settleInfo.fee != 0) {
      balanceOf[account] += settleInfo.realized + settleInfo.fee;
    }
    chargeFee(-settleInfo.fee, FundType.Settle);
  }

  function settleExpiry(uint settledPrice, address account, uint expiry) private returns (SettleInfo memory settleInfo)  {
    uint exerciseFeeRate = config.exerciseFeeRate();
    uint profitFeeRate = config.profitFeeRate();
    uint[] memory strikes = listOfStrikes(account, expiry);
    for (uint i = 0; i < strikes.length; ++i) {
      settleStrike(exerciseFeeRate, profitFeeRate, settledPrice, account, expiry, strikes[i], settleInfo);
    }
  }

  function settleStrike(uint exerciseFeeRate, uint profitFeeRate, uint settledPrice, address account, uint expiry, uint strike, SettleInfo memory settleInfo) private {
    settleTradeType(exerciseFeeRate, profitFeeRate, settledPrice, account, expiry, strike, true, settleInfo);
    settleTradeType(exerciseFeeRate, profitFeeRate, settledPrice, account, expiry, strike, false, settleInfo);
  }

  function settleTradeType(uint exerciseFeeRate, uint profitFeeRate, uint settledPrice, address account, uint expiry, uint strike, bool isCall, SettleInfo memory settleInfo) private {
    Ledger.Position memory position = positionOf(account, expiry, strike, isCall);
    if (position.size != 0) {
      (int realized, int fee) = getTradeTypeSettledValue(exerciseFeeRate, profitFeeRate, strike, settledPrice, isCall, position.size);
      realized += position.notional;
      internalClearPosition(account, expiry, strike, isCall, realized, fee, ChangeType.Settle);
      settleInfo.realized += realized;
      settleInfo.fee += fee;
    }
  }

  function liquidate(
    address account,
    uint expiry,
    uint strike,
    bool isCall,
    int size
  ) public returns (int) {
    if (size <= 0) {
      revert InvalidSize(1);
    }
    if (getTimestamp() >= expiry) {
      revert InvalidTime(2);
    }

    int availableSize = positionSizeOf(account, expiry, strike, isCall);
    if (availableSize == 0) {
      revert ZeroPosition();
    }

    TxCache memory txCache = initTxCache();
    LiquidateInfo memory liquidateInfo = getLiquidateInfo(txCache, account);
    if (liquidateInfo.healthFactor >= int(liquidateInfo.liquidateRate)) {
      revert CannotLiquidate();
    }

    if (availableSize < 0) {
      size = -size;
      uint ratedRisk = uint(-availableSize).decimalMul(txCache.spotInitialMarginRiskRate);

      availableSize = ratedRisk > liquidateInfo.maxLiquidation ? availableSize.decimalMul(int(liquidateInfo.maxLiquidation.decimalDiv(ratedRisk))) : availableSize;
      if (size < availableSize) {
        size = availableSize;
      }
    } else {
      // if (getPositions(account, txCache.now, txCache.spot, 1, false).sellLength > 0) {
      if (getPositions(txCache, account, 1, false).sellLength > 0) {
        revert SellPositionFirst();
      }
      if (size > availableSize) {
        size = availableSize;
      }
    }
    (int premium, int fee) = internalGetPremium(txCache, expiry, strike, isCall, -size, INT256_MAX, 0);
    if (availableSize > 0 && liquidateInfo.maxLiquidation < uint(premium + fee)) {
      size = size.decimalMulRoundUp(int(liquidateInfo.maxLiquidation)).decimalDivRoundUp(premium + fee);
      (premium, fee) = internalGetPremium(txCache, expiry, strike, isCall, -size, INT256_MAX, 0);
    }
    int reward = int(premium.abs()).decimalMul(int(liquidateInfo.liquidationReward));
    internalUpdatePosition(
      account, expiry, strike, isCall, -size, premium, fee - reward, ChangeType.Liquidate
    );
    internalUpdatePosition(
      msg.sender, expiry, strike, isCall, size, -premium, reward, ChangeType.Liquidate
    );
    if (internalGetAccountInfo(txCache, account).equity < 0) {
      revert InsufficientEquity(1);
    }
    if (internalGetAvailable(txCache, msg.sender) < 0) {
      revert Unavailable(3);
    }
    chargeFee(-fee, FundType.Liquidate);
    return int(size.abs());
  }

  function getLiquidateInfo(TxCache memory txCache, address account) private view returns (LiquidateInfo memory liquidateInfo) {
    PositionInfo memory positionInfo = getPositionInfo(txCache, account);
    AccountInfo memory accountInfo = internalGetAccountInfoWithPositionInfo(positionInfo, txCache, account);
    liquidateInfo.clearRate = config.clearRate();
    liquidateInfo.liquidateRate = config.liquidateRate();
    liquidateInfo.liquidationReward = config.liquidationReward();
    liquidateInfo.marginBalance = accountInfo.marginBalance;
    liquidateInfo.healthFactor = accountInfo.healthFactor;
    liquidateInfo.maxLiquidation = (accountInfo.available > 0 ? 0 : uint(-accountInfo.available)) + uint(positionInfo.buyValue - positionInfo.sellValue).decimalMul(liquidateInfo.liquidationReward);
    uint minLiquidation = config.minLiquidation();
    if (liquidateInfo.maxLiquidation < minLiquidation) {
      liquidateInfo.maxLiquidation = minLiquidation;
    }
  }

  function chargeFee(int fee, FundType fundType) internal {
    if (fee != 0) {
      uint insuranceProportion = config.insuranceProportion();
      int insuranceFee = fee.decimalMul(int(insuranceProportion));
      if (insuranceFee != 0) {
        updateBalance(config.insuranceAccount(), insuranceFee, fundType);
      }
      fee -= insuranceFee;
      if (fee != 0) {
        updateBalance(config.stakeholderAccount(), fee, fundType);
      }
    }
  }

  function updateBalance(address account, int change, FundType fundType) internal {
    balanceOf[account] += change;
    emit Fund(account, change, fundType);
  }

  function clear(address account) public {
    address insuranceAccount = config.insuranceAccount();
    if (account == insuranceAccount) {
      revert InvalidAccount();
    }

    TxCache memory txCache = initTxCache();
    LiquidateInfo memory liquidateInfo = getLiquidateInfo(txCache, account);
    uint[] memory expiries = listOfExpiries(account);
    if (!(liquidateInfo.healthFactor < int(liquidateInfo.clearRate) || expiries.length == 0 && liquidateInfo.marginBalance < 0)) {
      revert CannotClear();
    }

    for (uint i = 0; i < expiries.length; ++i) {
      uint expiry = expiries[i];
      uint[] memory strikes = listOfStrikes(account, expiry);
      for (uint j = 0; j < strikes.length; ++j) {
        uint strike = strikes[j];
        internalClear(insuranceAccount, account, expiry, strike, true);
        internalClear(insuranceAccount, account, expiry, strike, false);
      }
    }
    int balance = balanceOf[account];
    updateBalance(account, -balance, FundType.Clear);
    updateBalance(insuranceAccount, balance, FundType.Clear);
  }

  function internalClear(address insuranceAccount, address account, uint expiry, uint strike, bool isCall) internal {
    (int size, int notional) = internalClearPosition(account, expiry, strike, isCall, 0, 0, ChangeType.Clear);
    if (size != 0) {
      internalUpdatePosition(insuranceAccount, expiry, strike, isCall, size, notional, 0, ChangeType.Clear);
    }
  }

  function isIvOutdated(uint timestamp) internal view virtual returns (bool) {
    return timestamp > optionMarket.lastUpdatedAt() + OUTDATED_PERIOD;
  }

  function isMarketDisabled(TxCache memory /* txCache */, uint expiry, uint strike, bool isCall, bool isBuy) internal view virtual returns (bool) {
    return optionMarket.isMarketDisabled(expiry, strike ,isCall, isBuy);
  }

  function getSpotPrice() internal view virtual returns (uint) {
    return spotPricer.getPrice();
  }

  uint256[44] private __gap;
}
