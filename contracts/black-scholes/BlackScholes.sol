//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../libraries/SafeDecimalMath.sol";
import "../libraries/SignedSafeDecimalMath.sol";
import "./LnLookup.sol";
import "./CdfLookup.sol";
import "./SqrtTsAndPvs.sol";

contract BlackScholes is LnLookup, CdfLookup, SqrtTsAndPvs {
  using SafeDecimalMath for uint;
  using SignedSafeDecimalMath for int;

  function d1d2(
    uint tAnnualised,
    uint sqrtTs,
    uint volatility,
    uint spot,
    uint strike,
    int rate
  ) public view returns (int d1, int d2) {
    int vtSqrt = int(volatility.decimalMul(sqrtTs));
    int log = ln(spot.decimalDiv(strike));
    int v2t = (int(volatility.decimalMul(volatility) / 2) + rate).decimalMul(int(tAnnualised));
    d1 = (log + v2t).decimalDiv(vtSqrt);
    d2 = d1 - vtSqrt;
  }

  function getPrice(bool isCall, uint expiry, uint timeToExpirySec, uint volatility, uint spot, uint strike, int rate) public view returns (uint) {
    uint strikePV;
    int d1;
    int d2;
    {
      (uint sqrtTs, uint pvs) = getSqrtTsAndPvs(expiry - timeToExpirySec, expiry, rate);
      (d1, d2) = d1d2(timeToExpirySec.decimalDiv(SqrtTsAndPvs.SECONDS_PER_YEAR), sqrtTs, volatility, spot, strike, rate);
      strikePV = strike.decimalMul(pvs);
    }
    uint spotNd1 = spot.decimalMul(cdf(d1));
    uint strikeNd2 = strikePV.decimalMul(cdf(d2));
    uint call = strikeNd2 < spotNd1 ? spotNd1 - strikeNd2 : 0;
    uint put = call + strikePV;
    put = spot < put ? put - spot : 0;
    return isCall ? call : put;
  }
}
