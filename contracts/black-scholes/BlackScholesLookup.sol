//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../libraries/SafeDecimalMath.sol";
import "../libraries/SignedSafeDecimalMath.sol";
import "./LnLookup.sol";
import "./CdfLookup.sol";
import "./LookupUpdater.sol";

contract BlackScholesLookup is LnLookup, CdfLookup, LookupUpdater {
  using SafeDecimalMath for uint;
  using SignedSafeDecimalMath for int;

  uint private constant SECONDS_PER_YEAR = 31536000;

  function d1d2(
    uint tAnnualised,
    uint expiry,
    uint volatility,
    uint spot,
    uint strike,
    int rate
  ) public view returns (int d1, int d2) {
    int vtSqrt = int(volatility.decimalMul(sqrtTs[expiry]));
    int log = ln(spot.decimalDiv(strike));
    int v2t = (int(volatility.decimalMul(volatility) / 2) + rate).decimalMul(int(tAnnualised));
    d1 = (log + v2t).decimalDiv(vtSqrt);
    d2 = d1 - vtSqrt;
  }

  function getPrice(bool isCall, uint expiry, uint timeToExpirySec, uint volatility, uint spot, uint strike, int rate) public view returns (uint) {
    uint tAnnualised = timeToExpirySec.decimalDiv(SECONDS_PER_YEAR);
    (int d1, int d2) = d1d2(tAnnualised, expiry, volatility, spot, strike, rate);
    uint strikePV = strike.decimalMul(pvs[expiry]);
    uint spotNd1 = spot.decimalMul(cdf(d1));
    uint strikeNd2 = strikePV.decimalMul(cdf(d2));
    uint call = strikeNd2 < spotNd1 ? spotNd1 - strikeNd2 : 0;
    uint put = call + strikePV;
    put = spot < put ? put - spot : 0;
    return isCall ? call : put;
  }
}