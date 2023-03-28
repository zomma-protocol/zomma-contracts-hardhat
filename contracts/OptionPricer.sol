//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "./black-scholes/BlackScholesLookup.sol";
import "./libraries/SafeDecimalMath.sol";
import "./utils/Timestamp.sol";
import "./Config.sol";

contract OptionPricer is BlackScholesLookup, Timestamp {
  using SafeDecimalMath for uint;
  using SignedSafeDecimalMath for int;

  struct GetPremiumParams {
    uint now;
    uint spot;
    int riskFreeRate;
    uint initialMarginRiskRate;
    uint spotFee;
    uint optionFee;
    uint minPremium;
    uint expiry;
    uint strike;
    uint iv;
    int size;
    int available;
    int equity;
    uint priceRatio;
    uint priceRatio2;
    uint priceRatioUtilization;
    bool isCall;
  }

  Config public config;
  bool public initialized;

  // 57896044618658097711785492504343953926634992332820282019728792003956564819967
  int256 internal constant INT256_MAX = int256((uint256(1) << 255) - 1);

  function initialize(address _config) external {
    require(!initialized, "already initialized");
    initialized = true;
    config = Config(_config);
  }

  function updateLookup(uint[] calldata expiries) external {
    int riskFreeRate = config.riskFreeRate();
    uint time = getTimestamp();
    for (uint i = 0; i < expiries.length; ++i) {
      internalUpdateLookup(time, expiries[i], riskFreeRate);
    }
  }

  function getPremium(GetPremiumParams memory params) external view returns (int, int) {
    require(params.iv > 0, "iv is 0");
    bool isBuy = params.size > 0;
    uint absSize = uint(isBuy ? params.size : -params.size);
    uint price = getPrice(params.isCall, params.expiry, params.expiry - params.now, params.iv, params.spot, params.strike, params.riskFreeRate);
    if (params.available != INT256_MAX) {
      price = adjustPriceByUtilization(params, price, isBuy);
    }
    if (isBuy && price < params.minPremium) {
      price = params.minPremium;
    }
    uint fee = params.spot.decimalMul(params.spotFee) + price.decimalMul(params.optionFee);
    if (!isBuy && fee > price) {
      fee = price;
    }
    return (
      isBuy ? -int(price.decimalMul(absSize)) : int(price.decimalMul(absSize)),
      -int(fee.decimalMul(absSize))
    );
  }

  function adjustPriceByUtilization(GetPremiumParams memory params, uint price, bool isBuy) internal pure returns (uint) {
    if (params.available > params.equity) {
      params.available = params.equity;
    }
    require(params.available > 0, "available must be greater than 0");

    uint utilization = SafeDecimalMath.UNIT - uint(params.available.decimalDiv(params.equity));
    uint utilizationAfter;
    {
      int availableAfter;
      // pool sell
      if (isBuy) {
        uint maxRisk = uint(params.size).decimalMul(params.spot);
        int initialMarginChange = int(maxRisk.decimalMul(params.initialMarginRiskRate));
        availableAfter = params.available - initialMarginChange;
      } else {
        int value = int(price).decimalMul(params.size);
        availableAfter = params.available + value;
      }
      utilizationAfter = availableAfter >= 0 ? SafeDecimalMath.UNIT - uint(availableAfter.decimalDiv(params.equity)) : SafeDecimalMath.UNIT;
    }
    uint utilizationAdjust;
    if (utilization < params.priceRatioUtilization && utilizationAfter > params.priceRatioUtilization) {
      uint area1 = getArea(0, 0, params.priceRatioUtilization, params.priceRatio, (utilization + params.priceRatioUtilization) / 2, params.priceRatioUtilization - utilization);
      uint area2 = getArea(params.priceRatioUtilization, params.priceRatio, SafeDecimalMath.UNIT, params.priceRatio2, (params.priceRatioUtilization + utilizationAfter) / 2, utilizationAfter - params.priceRatioUtilization);
      utilizationAdjust = (area1 + area2).decimalDiv(utilizationAfter - utilization);
    } else {
      utilization = (utilization + utilizationAfter) / 2;
      if (utilization >= params.priceRatioUtilization) {
        utilizationAdjust = getY(params.priceRatioUtilization, params.priceRatio, SafeDecimalMath.UNIT, params.priceRatio2, utilization);
      } else {
        utilizationAdjust = getY(0, 0, params.priceRatioUtilization, params.priceRatio, utilization);
      }
    }
    utilizationAdjust += SafeDecimalMath.UNIT;
    return isBuy ? price.decimalMul(utilizationAdjust) : price.decimalDiv(utilizationAdjust);
  }

  // x: utilization
  // y: adjust
  function getY(uint x1, uint y1, uint x2, uint y2, uint x) internal pure returns (uint) {
    return (y2 - y1).decimalDiv(x2 - x1).decimalMul(x - x1) + y1;
  }

  function getArea(uint x1, uint y1, uint x2, uint y2, uint x, uint w) internal pure returns (uint) {
    return getY(x1, y1, x2, y2, x).decimalMul(w);
  }
}
