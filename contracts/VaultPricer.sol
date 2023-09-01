//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./libraries/SafeDecimalMath.sol";
import "./libraries/SignedSafeDecimalMath.sol";
import "./utils/Timestamp.sol";
import "./OptionMarket.sol";
import "./SpotPricer.sol";
import "./Config.sol";
import "./Vault.sol";
import "./interfaces/IOptionPricer.sol";
import "./interfaces/IVault.sol";

contract VaultPricer is IVault, Timestamp, Ownable {
  using SafeDecimalMath for uint;
  using SignedSafeDecimalMath for int;

  // 57896044618658097711785492504343953926634992332820282019728792003956564819967
  int256 private constant INT256_MAX = type(int).max;
  uint private constant ONE = 1 ether;

  Vault public vault;
  Config public config;
  SpotPricer public spotPricer;
  IOptionPricer public optionPricer;
  OptionMarket public optionMarket;

  function initialize(address _vault, address _config, address _spotPricer, address _optionPricer, address _optionMarket) external payable onlyOwner {
    vault = Vault(_vault);
    config = Config(_config);
    spotPricer = SpotPricer(_spotPricer);
    optionPricer = IOptionPricer(_optionPricer);
    optionMarket = OptionMarket(_optionMarket);
  }

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

  function initTxCache() private view returns (TxCache memory txCache) {
    address[] memory pools = config.getPools();
    txCache.poolLength = pools.length;
    txCache.spot = spotPricer.getPrice();
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

      if (isClose) {
        int size = vault.positionSizeOf(pool, positionParams.expiry, positionParams.strike, positionParams.isCall);
        if (!(isBuy && size > 0 || !isBuy && size < 0)) {
          unchecked { ++i; }
          continue;
        }
        tradingPoolsInfo.rates[i] = size;
        tradingPoolsInfo.totalSize += size;
      } else {
        if (!txCache.loaded[i]) {
          AccountInfo memory accountInfo = vault.getAccountInfo(pool);
          uint reservedRate = config.poolReservedRate(pool);
          txCache.available[i] = accountInfo.available;
          txCache.adjustedAvailable[i] = accountInfo.available - accountInfo.marginBalance.decimalMul(int(reservedRate));
          txCache.equity[i] = accountInfo.equity;
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
      optionMarket.getMarketIv(expiry, strike, isCall, size > 0),
      size,
      available,
      equity,
      txCache.priceRatio,
      txCache.priceRatio2,
      txCache.priceRatioUtilization,
      isCall
    ));
  }
}
