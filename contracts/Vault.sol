//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./libraries/SafeDecimalMath.sol";
import "./libraries/SignedSafeDecimalMath.sol";
import "./utils/Timestamp.sol";
import "./Ledger.sol";
import "./OptionMarket.sol";
import "./SpotPricer.sol";
import "./Config.sol";
import "./SignatureValidator.sol";
import "./interfaces/IOptionPricer.sol";
import "./interfaces/IVault.sol";

/**
 * @dev Main contract, including deposit, withdraw, trade and so on. keep assets in this contract.
 */
contract Vault is IVault, Ledger, Timestamp {
  using SafeDecimalMath for uint;
  using SignedSafeDecimalMath for int;
  using SafeERC20 for IERC20;

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

  struct TradeInfo {
    address account;
    uint acceptableTotal;
    int gasFee;
    uint deadline;
    address gasReceiver;
  }

  enum FundType { Trade, Deposit, Withdraw, Settle, Liquidate, Clear, Dust, Gas }

  // 57896044618658097711785492504343953926634992332820282019728792003956564819967
  int private constant INT256_MAX = type(int).max;
  int private constant OTM_WEIGHT = 10**40;
  int private constant EXPIRY_WEIGHT = 10**28;
  uint private constant OUTDATED_PERIOD = 1 hours;
  uint private constant MAX_REMOVE_POSITION = 50;
  uint private constant ONE = 1 ether;

  // keccak256("Trade(int256[] data,uint256 deadline,uint256 gasFee,uint256 nonce)")
  bytes32 private constant TRADE_TYPEHASH = 0x24b94e75dc12bacfb3efc705fe8e2061a19c206860e13b35b1000c4dfd4e577c;

  Config public config;
  SpotPricer public spotPricer;
  IOptionPricer public optionPricer;
  OptionMarket public optionMarket;
  bool public initialized;
  address public owner;
  SignatureValidator public signatureValidator;

  event Fund(address account, int amount, FundType fundType);

  error AlreadyInitialized();
  error ZeroAmount();
  error ZeroAmount2();
  error InvalidRate();
  error InvalidFreeWithdrawableRate();
  error UnacceptableAmount();
  error InsufficientEquity();
  error WithdrawTooMuch();
  error Unavailable();
  error PoolUnavailable();
  error InvalidSize();
  error InvalidTime();
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
  error InvalidInput();
  error Expired();
  error OutOfRange();

  /**
  * @dev Initalize method. Can call only once.
  * @param _config: Should be Config address.
  * @param _spotPricer: Should be SpotPricer address.
  * @param _optionPricer: Should be OptionPricer address.
  * @param _optionMarket: Should be OptionMarket address.
  */
  function initialize(address _config, address _spotPricer, address _optionPricer, address _optionMarket, address _signatureValidator) external {
    if (initialized) {
      revert AlreadyInitialized();
    }
    initialized = true;
    owner = msg.sender;
    setAddresses(_config, _spotPricer, _optionPricer, _optionMarket, _signatureValidator);
  }

  function checkOwner() internal view {
    if (msg.sender != owner) {
      revert NotOwner();
    }
  }

  /**
  * @dev Change contract addresses. Can call by owner only.
  * @param _config: Should be Config address.
  * @param _spotPricer: Should be SpotPricer address.
  * @param _optionPricer: Should be OptionPricer address.
  * @param _optionMarket: Should be OptionMarket address.
  */
  function setAddresses(address _config, address _spotPricer, address _optionPricer, address _optionMarket, address _signatureValidator) public payable {
    checkOwner();
    config = Config(_config);
    spotPricer = SpotPricer(_spotPricer);
    optionPricer = IOptionPricer(_optionPricer);
    optionMarket = OptionMarket(_optionMarket);
    signatureValidator = SignatureValidator(_signatureValidator);
  }

  /**
  * @dev Change owner address. Can call by owner only.
  * @param _owner: New owner address
  */
  function changeOwner(address _owner) external payable {
    checkOwner();
    owner = _owner;
  }

  /**
  * @dev Deposit to increase margin balance.
  * @param amount: How much to deposit. In decimals 18.
  */
  function deposit(uint amount) external {
    amount = amount.truncate(config.quoteDecimal());
    if (amount == 0) {
      revert ZeroAmount();
    }
    transferFrom(msg.sender, address(this), amount);
    updateBalance(msg.sender, int(amount), FundType.Deposit);
  }

  /**
  * @dev Withdraw available balance.
  * @param amount: How much to withdraw, In decimals 18.
  */
  function withdraw(uint amount) public {
    if (int(amount) <= 0) {
      revert ZeroAmount();
    }
    int available = internalGetAvailable(initTxCache(), msg.sender);
    if (int(amount) > available) {
      amount = available < 0 ? 0 : uint(available);
    }
    if (amount == 0) {
      revert ZeroAmount2();
    }
    updateBalance(msg.sender, -int(amount), FundType.Withdraw);
    collectDust(amount);
    transfer(msg.sender, amount);
  }

  /**
  * @dev Withdraw percentage of equity and remove positions if need to keep health factor healthy.
  *      This is used for pool withdrawal.
  * @param rate: Percentage. Range is 0 ~ 1, In decimals 18.
  * @param acceptableAmount: Acceptable amount after slippage. In decimals 18.
  * @param freeWithdrawableRate: A threshold that can withdraw without removing positions. Range is 0 ~ 1. In decimals 18.
  *                              Concept is that if pool is low utilization, unnecessary to remove positions.
  *                              For example, freeWithdrawableRate 0.4 means that it can withdraw without removing positions if utilization is below 40%.
  *                              If withdraw amount will cause utilization over 40%, it should remove positions to keep utilization 40%.
  * @return amount: Actual withdrawal amount
  */
  function withdrawPercent(uint rate, uint acceptableAmount, uint freeWithdrawableRate) public returns (uint) {
    if (rate == 0 || rate > ONE) {
      revert InvalidRate();
    }
    if (freeWithdrawableRate > ONE) {
      revert InvalidFreeWithdrawableRate();
    }
    int amount = internalWithdrawPercent(msg.sender, rate, freeWithdrawableRate);
    if (amount <= 0) {
      revert ZeroAmount();
    }
    if (uint(amount) < acceptableAmount) {
      revert UnacceptableAmount();
    }
    updateBalance(msg.sender, -amount, FundType.Withdraw);
    collectDust(uint(amount));
    transfer(msg.sender, uint(amount));
    return uint(amount);
  }

  /**
  * @dev System use decimals 18 for ledger, but quote token may be less decimals (e.g. 6). For correct accounting, dust will be collect as fee.
  *      For example, if quote decimals 6, an user balance is 1.0000012 in zomma and withdraw all. He can receive only 1.000001. We collect 0.0000002 as fee.
  */
  function collectDust(uint amount) private {
    amount -= amount.truncate(config.quoteDecimal());
    if (amount > 0) {
      chargeFee(int(amount), FundType.Dust);
    }
  }

  function transfer(address to, uint amount) private {
    IERC20(config.quote()).safeTransfer(to, (amount * 10**config.quoteDecimal()) / ONE);
  }

  function transferFrom(address from, address to, uint amount) private {
    IERC20(config.quote()).safeTransferFrom(from, to, (amount * 10**config.quoteDecimal()) / ONE);
  }

  function internalWithdrawPercent(address account, uint rate, uint freeWithdrawableRate) private returns (int) {
    TxCache memory txCache = initTxCache();
    PositionInfo memory positionInfo = getPositionInfo(txCache, account);
    AccountInfo memory accountInfo = internalGetAccountInfoWithPositionInfo(positionInfo, txCache, account);
    if (accountInfo.equity <= 0) {
      revert InsufficientEquity();
    }

    int expectToWithdrawAmount = accountInfo.equity.decimalMul(int(rate));
    int freeWithdrawableAmount;
    if (freeWithdrawableRate > 0) {
      uint reservedRate = config.poolReservedRate(account);
      int reserved = accountInfo.marginBalance.decimalMul(int(reservedRate));
      int adjustedAvailable = accountInfo.available - reserved;
      int adjustedEquity = accountInfo.equity - reserved;
      int maxFreeWithdrawableAmount = adjustedEquity - (adjustedEquity - adjustedAvailable).decimalDiv(int(freeWithdrawableRate));
      if (reservedRate < ONE) {
        unchecked { maxFreeWithdrawableAmount = maxFreeWithdrawableAmount.decimalDiv(int(ONE - reservedRate)); }
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
      unchecked { return reducePosition(account, expectToWithdrawAmount - freeWithdrawableAmount, txCache, positionInfo, accountInfo); }
    } else {
      return freeWithdrawableAmount;
    }
  }

  /**
  * @dev Consider to effeciently reduce initial margin. Remove sold position first.
  * @param account: Account
  * @param amountToRemove: Lack of available amount. Remove positions to release for withdrawal.
  * @param txCache: TxCache object
  * @param positionInfo: PositionInfo object
  * @param accountInfo: AccountInfo object
  */
  function reducePosition(address account, int amountToRemove, TxCache memory txCache, PositionInfo memory positionInfo, AccountInfo memory accountInfo) private returns (int) {
    uint rate = uint(amountToRemove.decimalDivRound(accountInfo.equity));
    // sold position risk
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
      rate == ONE
    );
    if (reducePositionParams.amountToRemove > 0) {
      reducePositionSub(reducePositionParams, txCache, removePositions, false);
    }

    // more than sold risk, may remove bought position
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
    // use actual equity to include fee loss
    // actual witdrawal amount will be actual equity - expected remain
    // notice: accountInfo.equity excluded freeWithdrawableAmount in previous function
    return internalGetAccountInfo(txCache, account).equity - (accountInfo.equity - amountToRemove);
  }

  /**
  * @dev Reduce positions of sold or bought.
  */
  function reducePositionSub(ReducePositionParams memory reducePositionParams, TxCache memory txCache, RemovePositions memory removePositions, bool isBuy) private {
    PositionParams[50] memory positions;
    int lastIndex;
    if (isBuy) {
      positions = removePositions.buyPositions;
      unchecked { lastIndex = int(removePositions.buyLength) - 1; }
    } else {
      positions = removePositions.sellPositions;
      unchecked { lastIndex = int(removePositions.sellLength) - 1; }
    }
    quickSort(positions, 0, lastIndex);

    for (int i = lastIndex; i >= 0;) {
      PositionParams memory position = positions[uint(i)];
      reduceTradeTypePosition(reducePositionParams, position, txCache);
      if (reducePositionParams.removeAll) {
        unchecked { --i; }
        continue;
      }
      if (reducePositionParams.done) {
        return;
      }
      // reducePositionParams.amountToRemove means risk when sold, value when bought
      uint removedAmount = isBuy ? uint(reducePositionParams.amountChange) : uint(reducePositionParams.sizeChange).decimalMul(txCache.spotInitialMarginRiskRate);
      if (removedAmount >= reducePositionParams.amountToRemove) {
        return;
      }
      reducePositionParams.amountToRemove -= removedAmount;
      unchecked { --i; }
    }
    if (!reducePositionParams.removeAll || removePositions.morePositions) {
      revert WithdrawTooMuch();
    }
  }

  /**
  * @dev Reduce a position.
  */
  function reduceTradeTypePosition(ReducePositionParams memory reducePositionParams, PositionParams memory position, TxCache memory txCache) private {
    reducePositionParams.sizeChange = 0;
    int size = position.size;
    bool isBuy = size > 0;
    // when sold position, check if this position risk is more than required
    if (!reducePositionParams.removeAll && !isBuy) {
      uint ratedRisk = uint(-size).decimalMul(txCache.spotInitialMarginRiskRate);
      if (reducePositionParams.amountToRemove < ratedRisk) {
        size = size.decimalMulRoundUp(int(reducePositionParams.amountToRemove)).decimalDivRoundUp(int(ratedRisk));
        reducePositionParams.done = true;
      }
    }
    position.size = -size;
    TradingPoolsInfo memory tradingPoolsInfo = getTradingPoolsInfo(txCache, position, true, reducePositionParams.account);
    int closePremium;
    int closeFee;
    // check available closing size, three possible cases
    // 1. open: no available closing size
    // 2. close: available closing size is more than required
    // 3. close and open: available closing size is less than required
    if (tradingPoolsInfo.totalSize.abs() < size.abs()) {
      if (tradingPoolsInfo.totalSize != 0) {
        int tradedSize;
        (closePremium, closeFee, tradedSize) = reduceTradeTypePositionSub(reducePositionParams, position, txCache, 0, isBuy, tradingPoolsInfo.totalSize, tradingPoolsInfo);
        if (isBuy && reducePositionParams.done) {
          size = 0;
        } else {
          unchecked { size -= -tradedSize; }
        }
        position.size = -size;
      }
      if (size != 0) {
        tradingPoolsInfo = getTradingPoolsInfo(txCache, position, false, reducePositionParams.account);
      }
    }

    int premium;
    int fee;
    if (size != 0) {
      (premium, fee, ) = reduceTradeTypePositionSub(reducePositionParams, position, txCache, isBuy ? uint(closePremium + closeFee) : 0, isBuy, -size, tradingPoolsInfo);
      if (!tradingPoolsInfo.isClose) {
        if (tradingPoolsInfo.totalAdjustedAvailable < 0) {
          revert PoolUnavailable();
        }
      }
    }
    reducePositionParams.amountChange = premium + closePremium;
    reducePositionParams.sizeChange = internalUpdatePosition(
      reducePositionParams.account, position.expiry, position.strike, position.isCall, reducePositionParams.sizeChange, reducePositionParams.amountChange, fee + closeFee, ChangeType.Trade, 0
    );
    reducePositionParams.amountChange += fee + closeFee;
  }

  /**
  * @dev Reduce a position and should not remove too much over expected.
  * @param removingAmount: value to remove
  * @return premium: Premium. It will be positive when sell, and negative when buy. In decimals 18.
  * @return fee: Fee. Should be negative. In decimals 18.
  * @return size: Actual removed size. In decimals 18.
  */
  function reduceTradeTypePositionSub(ReducePositionParams memory reducePositionParams, PositionParams memory position, TxCache memory txCache, uint removingAmount, bool isBuy, int size, TradingPoolsInfo memory tradingPoolsInfo) private returns (int, int, int) {
    (int premium, int fee) = internalGetPremium(txCache, position.expiry, position.strike, position.isCall, size, tradingPoolsInfo.isClose ? INT256_MAX : tradingPoolsInfo.totalAvailable, tradingPoolsInfo.totalEquity);
    // when bought position, check if removed value is more than required
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
    if (right <= left) {
      return;
    }
    int i = left;
    int j = right;
    unchecked {
      int pivot = arr[uint((left + right) >> 1)].notional;
      while (i <= j) {
        while (arr[uint(i)].notional < pivot) {
          ++i;
        }
        while (pivot < arr[uint(j)].notional) {
          --j;
        }
        if (i <= j) {
          (arr[uint(i)], arr[uint(j)]) = (arr[uint(j)], arr[uint(i)]);
          ++i;
          --j;
        }
      }
    }
    quickSort(arr, left, j);
    quickSort(arr, i, right);
  }

  /**
  * @dev Load positions of this account.
  */
  function getPositions(TxCache memory txCache, address account, uint maxLength, bool checkDisable) private view returns (RemovePositions memory removePositions) {
    uint[] memory expiries = listOfExpiries(account);
    uint expiriesLength = expiries.length;
    if (checkDisable && (optionMarket.tradeDisabled() || isIvOutdated(txCache.now))) {
      removePositions.morePositions = expiriesLength != 0;
      return removePositions;
    }
    unchecked {
      for (uint i; i < expiriesLength; ++i) {
        uint expiry = expiries[i];
        if (checkDisable && (txCache.now >= expiry || optionMarket.expiryDisabled(expiry))) {
          removePositions.morePositions = true;
          continue;
        }
        uint[] memory strikes = listOfStrikes(account, expiry);
        uint strikesLength = strikes.length;
        for (uint j; j < strikesLength; ++j) {
          pushPositions(txCache, account, expiry, strikes[j], maxLength, removePositions, checkDisable);
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
  }

  function pushPositions(TxCache memory txCache, address account, uint expiry, uint strike, uint maxLength, RemovePositions memory removePositions, bool checkDisable) internal view {
    pushPosition(txCache, account, expiry, strike, true, maxLength, removePositions, checkDisable);
    pushPosition(txCache, account, expiry, strike, false, maxLength, removePositions, checkDisable);
  }

  /**
  * @dev Consider to effeciently remove positions. Remove lower trading fee first.
  *      Ordering will be otm first, expiry closer first, and less difference of spot price minus strike first.
  */
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

  /**
  * @dev Allocating position and fee to pools.
  */
  function internalPoolUpdatePosition(PositionParams memory positionParams, TxCache memory txCache, TradingPoolsInfo memory tradingPoolsInfo, int fee) internal virtual returns (int) {
    int poolFee = fee.decimalMul(int(txCache.poolProportion));
    UpdatePositionInfo memory info = UpdatePositionInfo(positionParams.size, positionParams.notional, poolFee, tradingPoolsInfo.totalSize == -positionParams.size);
    int sellSizeChange;
    int notional;
    int subFee;
    uint index;
    uint lastIndex;
    unchecked { lastIndex = tradingPoolsInfo.length - 1; }
    for (uint i; i < lastIndex;) {
      index = tradingPoolsInfo.indexes[i];
      (sellSizeChange, notional, subFee) = internalUpdatePositionSub(positionParams, txCache.pools[index], tradingPoolsInfo.rates[index], poolFee, info);
      updateAvailableCache(tradingPoolsInfo, txCache, index, sellSizeChange, notional, subFee);
      if (info.remainSize == 0) {
        break;
      }
      unchecked { ++i; }
    }
    if (info.remainSize != 0) {
      index = tradingPoolsInfo.indexes[lastIndex];
      notional = info.remainNotional;
      subFee = info.remainFee;
      sellSizeChange = internalUpdatePosition(
        txCache.pools[index], positionParams.expiry, positionParams.strike, positionParams.isCall, info.remainSize, info.remainNotional, info.remainFee, ChangeType.Trade, 0
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
      account, positionParams.expiry, positionParams.strike, positionParams.isCall, sellSizeChange, notional, subFee, ChangeType.Trade, 0
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
    uint expiriesLength = expiries.length;
    for (uint i; i < expiriesLength;) {
      positionParams.expiry = expiries[i];
      uint settledPrice = txCache.now >= positionParams.expiry ? spotPricer.settledPrices(positionParams.expiry) : 0;
      uint[] memory strikes = listOfStrikes(account, positionParams.expiry);
      uint strikesLength = strikes.length;
      for (uint j; j < strikesLength;) {
        positionParams.strike = strikes[j];
        getPositionInfoSub(txCache, account, settledPrice, positionParams, positionInfo, true);
        getPositionInfoSub(txCache, account, settledPrice, positionParams, positionInfo, false);
        unchecked { ++j; }
      }
      unchecked { ++i; }
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
    // If position expired, get value by settlement rule. If settled price is not set yet, use spot price in temporary
    (value, fee) = txCache.now >= positionParams.expiry ?
      getTradeTypeSettledValue(txCache.exerciseFeeRate, txCache.profitFeeRate, positionParams.strike, settledPrice == 0 ? txCache.spot :
      settledPrice, positionParams.isCall, positionParams.size) : internalGetPremium(txCache, positionParams.expiry, positionParams.strike, positionParams.isCall, -positionParams.size, INT256_MAX, 0);
  }

  function getTradeTypeSettledValue(uint exerciseFeeRate, uint profitFeeRate, uint strike, uint settledPrice, bool isCall, int size) private pure returns (int value, int fee) {
    if (isCall) {
      if (settledPrice > strike) {
        unchecked { value = int(settledPrice - strike).decimalMul(size); }
      }
    } else {
      if (settledPrice < strike) {
        unchecked { value = int(strike - settledPrice).decimalMul(size); }
      }
    }
    // settlement fee: min(settlement price * 0.015%, options value * 10%)
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
    for (uint i; i < txCache.poolLength;) {
      txCache.pools[i] = pools[i];
      unchecked { ++i; }
    }
  }

  /**
  * @dev Get information of pools for trading. Including available and equity. This is used for calculate option price and proportion of pools.
  * @param txCache: Cache object.
  * @param positionParams: Trading information.
  * @param isClose: Specify if it is closing position. If true, proportion bases on size of open positions.
  * @param excludedPool: Exclude a pool. It's used for withdrawing from a pool and needs to remove positions. Can't trade with itself.
  */
  function getTradingPoolsInfo(TxCache memory txCache, PositionParams memory positionParams, bool isClose, address excludedPool) private view returns(TradingPoolsInfo memory tradingPoolsInfo) {
    bool isBuy = positionParams.size > 0;
    tradingPoolsInfo.isClose = isClose;
    uint poolLength = txCache.poolLength;
    uint length;
    for (uint i; i < poolLength;) {
      address pool = txCache.pools[i];
      if (excludedPool == pool) {
        unchecked { ++i; }
        continue;
      }

      // count by available to close size when closing
      if (isClose) {
        int size = positionSizeOf(pool, positionParams.expiry, positionParams.strike, positionParams.isCall);
        if (!(isBuy && size > 0 || !isBuy && size < 0)) {
          unchecked { ++i; }
          continue;
        }
        tradingPoolsInfo.rates[i] = size;
        tradingPoolsInfo.totalSize += size;
      } else {
        // count by available liquidity when opening
        if (!txCache.loaded[i]) {
          (uint paused, uint reservedRate) = config.getPoolReservedRateForTrade(pool);
          if (paused != 1) {
            AccountInfo memory accountInfo = internalGetAccountInfo(txCache, pool);
            txCache.available[i] = accountInfo.available;
            txCache.adjustedAvailable[i] = accountInfo.available - accountInfo.marginBalance.decimalMul(int(reservedRate));
            txCache.equity[i] = accountInfo.equity;
          } else {
            txCache.adjustedAvailable[i] = 0;
          }
          txCache.loaded[i] = true;
        }
        if (txCache.adjustedAvailable[i] > 0) {
          tradingPoolsInfo.rates[i] = txCache.adjustedAvailable[i];
          tradingPoolsInfo.totalAvailable += txCache.available[i];
          unchecked { tradingPoolsInfo.totalAdjustedAvailable += txCache.adjustedAvailable[i]; }
        }
        tradingPoolsInfo.totalEquity += txCache.equity[i];
      }
      if (tradingPoolsInfo.rates[i] != 0) {
        tradingPoolsInfo.indexes[length++] = i;
      }
      unchecked { ++i; }
    }

    if (length > 0) {
      int remaining = int(ONE);
      int base = isClose ? tradingPoolsInfo.totalSize : tradingPoolsInfo.totalAdjustedAvailable;
      uint index;
      uint lastIndex;
      unchecked {
        lastIndex = length - 1;
        for (uint i; i < lastIndex; ++i) {
          index = tradingPoolsInfo.indexes[i];
          tradingPoolsInfo.rates[index] = tradingPoolsInfo.rates[index].decimalDivRound(base);
          remaining -= tradingPoolsInfo.rates[index];
        }
      }
      index = tradingPoolsInfo.indexes[lastIndex];
      tradingPoolsInfo.rates[index] = remaining;
      tradingPoolsInfo.length = length;
    }
  }

  function tradeBySignature(int[] calldata data, uint deadline, uint gasFee, uint nonce, uint8 v, bytes32 r, bytes32 s) external {
    if (int(gasFee) < 0) {
      revert OutOfRange();
    }
    bytes memory aheadEncodedData = abi.encode(TRADE_TYPEHASH, keccak256(abi.encodePacked(data)), deadline, gasFee);
    address signer = signatureValidator.recoverAndUseNonce(aheadEncodedData, nonce, v, r, s);
    internalTrade(data, TradeInfo(signer, 0, int(gasFee), deadline, msg.sender));
  }

  /**
  * @dev Batch trade. Can only trade not expired, tradable and available enough except closing positions. (After trade available should be >= 0)
  * @param data: Trade data. Should be multiples of 5. It means following arguments.
  *              uint expiry: Expiry timestamp.
  *              uint strike: Strike. In decimals 18.
  *              bool isCall: true is call, and false is put. Pass 0 or 1 in data.
  *              int size: Size to trade. Positive is buy, and negative is sell. In decimals 18.
  *              uint acceptableTotal: Acceptable amount after slippage, including fee. In decimals 18.
  *                                    It means pay out premium when buy, and receive when sell.
  */
  function trade(int[] calldata data, uint deadline) public {
    internalTrade(data, TradeInfo(msg.sender, 0, 0, deadline, msg.sender));
  }

  function internalTrade(int[] calldata data, TradeInfo memory tradeInfo) internal {
    uint length = data.length;
    if (length == 0 || length % 5 != 0) {
      revert InvalidInput();
    }
    if (optionMarket.tradeDisabled()) {
      revert TradeDisabled();
    }
    TxCache memory txCache = initTxCache();
    if (txCache.now > tradeInfo.deadline) {
      revert Expired();
    }
    if (isIvOutdated(txCache.now)) {
      revert IvOutdated();
    }
    txCache.isTraderClosing = true;
    int availableBefore;
    int origGasFee = tradeInfo.gasFee;
    if (origGasFee > 0) {
      updateBalance(tradeInfo.gasReceiver, origGasFee, FundType.Gas);
      tradeInfo.gasFee = -origGasFee;
      availableBefore = internalGetAvailable(txCache, tradeInfo.account);
    }
    int platformFee;
    for (uint i;i < length;) {
      int fee;
      unchecked {
        tradeInfo.acceptableTotal = uint(data[i + 4]);
        fee = internalTradeSub(txCache, PositionParams(uint(data[i]), uint(data[i + 1]), data[i + 2] == 1, data[i + 3], 0), tradeInfo);
      }
      tradeInfo.gasFee = 0;
      platformFee += fee;
      unchecked { i += 5; }
    }
    if (txCache.isTraderClosing) {
      if (origGasFee > 0) {
        int availableAfter = internalGetAvailable(txCache, tradeInfo.account);
        if (availableAfter < 0 && availableAfter < availableBefore) {
          revert Unavailable();
        }
      }
    } else if (internalGetAvailable(txCache, tradeInfo.account) < 0) {
      revert Unavailable();
    }

    chargeFee(platformFee, FundType.Trade);
    afterTrade(txCache);
  }

  function afterTrade(TxCache memory txCache) internal view virtual {
  }

  function internalTradeSub(TxCache memory txCache, PositionParams memory positionParams, TradeInfo memory tradeInfo) internal returns(int platformFee) {
    int size = positionParams.size;
    if (size == 0) {
      revert InvalidSize();
    }
    if (getTimestamp() >= positionParams.expiry) {
      revert InvalidTime();
    }
    if (optionMarket.expiryDisabled(positionParams.expiry) || isMarketDisabled(txCache, positionParams.expiry, positionParams.strike ,positionParams.isCall, size > 0)) {
      revert TradeDisabled();
    }

    address account = tradeInfo.account;
    int premium;
    int fee;
    TradingPoolsInfo memory tradingPoolsInfo = getTradingPoolsInfo(txCache, positionParams, true, account);
    {
      int closePremium;
      int closeFee;
      int remainSize = size;
      // check available closing size, three possible cases
      // 1. open: no available closing size
      // 2. close: available closing size is more than required
      // 3. close and open: available closing size is less than required
      if (tradingPoolsInfo.totalSize.abs() < size.abs()) {
        if (tradingPoolsInfo.totalSize != 0) {
          (closePremium, closeFee) = internalGetPremium(txCache, positionParams.expiry, positionParams.strike, positionParams.isCall, tradingPoolsInfo.totalSize, INT256_MAX, 0);
          positionParams.size = -tradingPoolsInfo.totalSize;
          positionParams.notional = -closePremium;
          platformFee = internalPoolUpdatePosition(positionParams, txCache, tradingPoolsInfo, -closeFee);
          remainSize -= tradingPoolsInfo.totalSize;
          positionParams.size = size;
        }
        tradingPoolsInfo = getTradingPoolsInfo(txCache, positionParams, false, account);
      }
      (premium, fee) = internalGetPremium(txCache, positionParams.expiry, positionParams.strike, positionParams.isCall, remainSize, tradingPoolsInfo.isClose ? INT256_MAX : tradingPoolsInfo.totalAvailable, tradingPoolsInfo.totalEquity);
      positionParams.size = -remainSize;
      positionParams.notional = -premium;
      platformFee += internalPoolUpdatePosition(positionParams, txCache, tradingPoolsInfo, -fee);
      fee += closeFee;
      premium += closePremium;
    }
    {
      int total = premium + fee;
      if (!tradingPoolsInfo.isClose) {
        if (tradingPoolsInfo.totalAdjustedAvailable < 0) {
          revert PoolUnavailable();
        }
        if (size > 0 ? total >= 0 : total <= 0) {
          revert ZeroPrice();
        }
      }
      if (total < (size > 0 ? -int(tradeInfo.acceptableTotal) : int(tradeInfo.acceptableTotal))) {
        revert UnacceptablePrice();
      }
    }
    txCache.isTraderClosing = txCache.isTraderClosing && traderClosing(account, positionParams.expiry, positionParams.strike, positionParams.isCall, size);
    internalUpdatePosition(
      account, positionParams.expiry, positionParams.strike, positionParams.isCall, size, premium, fee, ChangeType.Trade, tradeInfo.gasFee
    );
  }

  /**
  * @dev Estimate premium and fee.
  * @param expiry: Expiry timestamp.
  * @param strike: Strike. In decimals 18.
  * @param isCall: true is call, and false is put.
  * @param size: Size to trade. Positive is buy, and negative is sell. In decimals 18.
  * @return premium: Premium. It will be positive when sell, and negative when buy. In decimals 18.
  * @return fee: Fee. Should be negative. In decimals 18.
  */
  function getPremium(uint expiry, uint strike, bool isCall, int size) external view returns (int, int) {
    TxCache memory txCache = initTxCache();
    if (txCache.now >= expiry) {
      uint settledPrice = spotPricer.settledPrices(expiry);
      return getTradeTypeSettledValue(txCache.exerciseFeeRate, txCache.profitFeeRate, strike, settledPrice == 0 ? txCache.spot : settledPrice, isCall, -size);
    } else {
      PositionParams memory positionParams = PositionParams(expiry, strike, isCall, size, 0);
      TradingPoolsInfo memory tradingPoolsInfo = getTradingPoolsInfo(txCache, positionParams, true, address(0));
      int closePremium;
      int closeFee;
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

  /**
  * @dev Check current trade is closing for trader
  */
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

  /**
  * @dev Settle all position of the account and expiry. Can call only after expired and settled price ready.
  * @param account: Target account address to settle.
  * @param expiry: Expiry timestamp.
  */
  function settle(address account, uint expiry) public {
    if (getTimestamp() < expiry) {
      revert InvalidTime();
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
    uint strikesLength = strikes.length;
    for (uint i; i < strikesLength;) {
      settleStrike(exerciseFeeRate, profitFeeRate, settledPrice, account, expiry, strikes[i], settleInfo);
      unchecked { ++i; }
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

  /**
  * @dev Liquidate a position. Can call only hf < liquidateRate (default is 0.5), and should liquidate sold positions first.
  * @param account: Target account address to liquidate.
  * @param expiry: Expiry timestamp.
  * @param strike: Strike. In decimals 18.
  * @param isCall: true is call, and false is put.
  * @param size: Size to liquidate, must be positive. In decimals 18.
  * @return liquidatedSize: Actual liquidated size, positive. In decimals 18.
  */
  function liquidate(
    address account,
    uint expiry,
    uint strike,
    bool isCall,
    int size
  ) public returns (int) {
    if (size <= 0) {
      revert InvalidSize();
    }
    if (getTimestamp() >= expiry) {
      revert InvalidTime();
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
      account, expiry, strike, isCall, -size, premium, fee - reward, ChangeType.Liquidate, 0
    );
    internalUpdatePosition(
      msg.sender, expiry, strike, isCall, size, -premium, reward, ChangeType.Liquidate, 0
    );
    if (internalGetAccountInfo(txCache, account).equity < 0) {
      revert InsufficientEquity();
    }
    if (internalGetAvailable(txCache, msg.sender) < 0) {
      revert Unavailable();
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
      unchecked { fee -= insuranceFee; }
      if (fee != 0) {
        updateBalance(config.stakeholderAccount(), fee, fundType);
      }
    }
  }

  function updateBalance(address account, int change, FundType fundType) internal {
    balanceOf[account] += change;
    emit Fund(account, change, fundType);
  }

  /**
  * @dev Clear an account. insuranceAccount will take over all balance and positions. Can call only hf < clearRate (default is 0.2) or negative balance without any position.
  * @param account: Target account address to liquidate.
  */
  function clear(address account) public {
    address insuranceAccount = config.insuranceAccount();
    if (account == insuranceAccount) {
      revert InvalidAccount();
    }

    TxCache memory txCache = initTxCache();
    LiquidateInfo memory liquidateInfo = getLiquidateInfo(txCache, account);
    uint[] memory expiries = listOfExpiries(account);
    uint expiriesLength = expiries.length;
    if (!(liquidateInfo.healthFactor < int(liquidateInfo.clearRate) || expiriesLength == 0 && liquidateInfo.marginBalance < 0)) {
      revert CannotClear();
    }
    for (uint i; i < expiriesLength;) {
      uint expiry = expiries[i];
      uint[] memory strikes = listOfStrikes(account, expiry);
      uint strikesLength = strikes.length;
      for (uint j; j < strikesLength;) {
        uint strike = strikes[j];
        internalClear(insuranceAccount, account, expiry, strike, true);
        internalClear(insuranceAccount, account, expiry, strike, false);
        unchecked { ++j; }
      }
      unchecked { ++i; }
    }
    int balance = balanceOf[account];
    updateBalance(account, -balance, FundType.Clear);
    updateBalance(insuranceAccount, balance, FundType.Clear);
  }

  function internalClear(address insuranceAccount, address account, uint expiry, uint strike, bool isCall) internal {
    (int size, int notional) = internalClearPosition(account, expiry, strike, isCall, 0, 0, ChangeType.Clear);
    if (size != 0) {
      internalUpdatePosition(insuranceAccount, expiry, strike, isCall, size, notional, 0, ChangeType.Clear, 0);
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

  uint[43] private __gap;
}
