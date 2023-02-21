//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../libraries/SafeDecimalMath.sol";
import "../libraries/SignedSafeDecimalMath.sol";

contract LookupUpdater {
  using SafeDecimalMath for uint;
  using SignedSafeDecimalMath for int;

  mapping(uint => uint) public sqrtTs;
  mapping(uint => uint) public pvs;

  uint private constant SECONDS_PER_YEAR = 31536000;
  uint private constant LN_2 = 693147180559945309; // 0.693147180559945309
  int private constant MIN_EXP = -42 * int(SafeDecimalMath.UNIT);
  uint private constant MAX_EXP = 100 * SafeDecimalMath.UNIT;

  event UpdateLookup(uint expiry, uint sqrtTs, uint pvs);

  function exp(uint x) public pure returns (uint) {
    if (x == 0) {
      return SafeDecimalMath.UNIT;
    }
    require(x <= MAX_EXP, "cannot handle exponents greater than 100");

    uint k = x / LN_2;
    uint p = 2**k;
    uint r = x - (k * LN_2);
    uint t = SafeDecimalMath.UNIT;
    uint lastT;
    for (uint i = 16; i > 0; i--) {
      t = (t.decimalMul(r / i) + SafeDecimalMath.UNIT);
      if (t == lastT) {
        break;
      }
      lastT = t;
    }
    return p * t;
  }

  function exp(int x) public pure returns (uint) {
    if (x >= 0) {
      return exp(uint(x));
    } else if (x < MIN_EXP) {
      // exp(-42) < 1e-18, so we just return 0
      return 0;
    } else {
      return SafeDecimalMath.UNIT.decimalDiv(exp(uint(-x)));
    }
  }

  function sqrt(uint x) public pure returns (uint y) {
    uint z = (x + 1) >> 1;
    y = x;
    while (z < y) {
      y = z;
      z = (x / z + z) >> 1;
    }
  }

  function internalUpdateLookup(uint timestamp, uint expiry, int rate) internal {
    (uint s, uint p) = getSqrtTsAndPvs(timestamp, expiry, rate);
    sqrtTs[expiry] = s;
    pvs[expiry] = p;
    emit UpdateLookup(expiry, s, p);
  }

  function getSqrtTsAndPvs(uint timestamp, uint expiry, int rate) internal pure returns(uint s, uint p) {
    uint tAnnualised = expiry > timestamp ? (expiry - timestamp).decimalDiv(SECONDS_PER_YEAR) : 0;
    s = sqrt(tAnnualised * SafeDecimalMath.UNIT);
    p = exp(-rate.decimalMul(int(tAnnualised)));
  }
}
