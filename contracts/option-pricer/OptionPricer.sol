//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../black-scholes/BlackScholes.sol";
import "../libraries/SafeDecimalMath.sol";
import "../utils/Timestamp.sol";
import "../interfaces/IOptionPricer.sol";

contract OptionPricer is IOptionPricer, BlackScholes, Timestamp {
  using SafeDecimalMath for uint;
  using SignedSafeDecimalMath for int;

  // 57896044618658097711785492504343953926634992332820282019728792003956564819967
  int256 private constant INT256_MAX = type(int).max;
  uint private constant ONE = 1 ether;

  /**
  * @dev Calculate and get premium and fee.
  * @return premium: Premium. It will be positive when sell, and negative when buy. In decimals 18.
  * @return fee: Fee. Should be negative. In decimals 18.
  */
  function getPremium(GetPremiumParams calldata params) external view returns (int, int) {
    checkIv(params.iv);
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

  /**
  * @dev Adjust price by utilization.
  * @return price: Adjusted price.
  */
  function adjustPriceByUtilization(GetPremiumParams calldata params, uint price, bool isBuy) internal pure returns (uint) {
    (uint utilization, uint utilizationAfter) = getUtilizations(params, price, isBuy);
    uint utilizationAdjust;
    if (utilization < params.priceRatioUtilization && utilizationAfter > params.priceRatioUtilization) {
      uint area1 = getArea(0, 0, params.priceRatioUtilization, params.priceRatio, (utilization + params.priceRatioUtilization) >> 1, params.priceRatioUtilization - utilization);
      uint area2 = getArea(params.priceRatioUtilization, params.priceRatio, ONE, params.priceRatio2, (params.priceRatioUtilization + utilizationAfter) >> 1, utilizationAfter - params.priceRatioUtilization);
      utilizationAdjust = (area1 + area2).decimalDiv(utilizationAfter - utilization);
    } else {
      utilization = (utilization + utilizationAfter) >> 1;
      if (utilization >= params.priceRatioUtilization) {
        utilizationAdjust = getY(params.priceRatioUtilization, params.priceRatio, ONE, params.priceRatio2, utilization);
      } else {
        utilizationAdjust = getY(0, 0, params.priceRatioUtilization, params.priceRatio, utilization);
      }
    }
    utilizationAdjust += ONE;
    return isBuy ? price.decimalMul(utilizationAdjust) : price.decimalDiv(utilizationAdjust);
  }

  function getUtilizations(GetPremiumParams calldata params, uint price, bool isBuy) internal pure returns (uint utilization, uint utilizationAfter) {
    int available = params.available;
    if (available > params.equity) {
      available = params.equity;
    }
    require(available > 0, "available must be greater than 0");

    utilization = ONE - uint(available.decimalDiv(params.equity));
    int availableAfter;
    // pool sell
    if (isBuy) {
      uint maxRisk = uint(params.size).decimalMul(params.spot);
      int initialMarginChange = int(maxRisk.decimalMul(params.initialMarginRiskRate));
      availableAfter = available - initialMarginChange;
    } else {
      int value = int(price).decimalMul(params.size);
      availableAfter = available + value;
    }
    utilizationAfter = availableAfter >= 0 ? ONE - uint(availableAfter.decimalDiv(params.equity)) : ONE;
  }

  // x: utilization
  // y: adjust
  function getY(uint x1, uint y1, uint x2, uint y2, uint x) internal pure returns (uint) {
    return (y2 - y1).decimalDiv(x2 - x1).decimalMul(x - x1) + y1;
  }

  function getArea(uint x1, uint y1, uint x2, uint y2, uint x, uint w) internal pure returns (uint) {
    return getY(x1, y1, x2, y2, x).decimalMul(w);
  }

  function checkIv(uint iv) internal pure virtual {
    require(iv > 0, "iv is 0");
  }

  uint256[50] private __gap;
}
