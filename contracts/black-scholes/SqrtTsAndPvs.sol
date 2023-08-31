//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../libraries/SafeDecimalMath.sol";
import "../libraries/SignedSafeDecimalMath.sol";

contract SqrtTsAndPvs {
  using SafeDecimalMath for uint;
  using SignedSafeDecimalMath for int;

  uint internal constant SECONDS_PER_YEAR = 31536000;
  uint private constant LN_2 = 693147180559945309; // 0.693147180559945309
  uint private constant ONE = 1 ether;
  int private constant MIN_EXP = -42 * int(ONE);
  uint private constant MAX_EXP = 100 * ONE;

  function exp(uint x) public pure returns (uint) {
    if (x == 0) {
      return ONE;
    }
    require(x <= MAX_EXP, "cannot handle exponents greater than 100");

    uint k = x / LN_2;
    uint p = 2**k;
    uint r = x - (k * LN_2);
    uint t = ONE;
    uint lastT;
    for (uint i = 16; i > 0;) {
      t = (t.decimalMul(r / i) + ONE);
      if (t == lastT) {
        break;
      }
      lastT = t;
      unchecked { --i; }
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
      return ONE.decimalDiv(exp(uint(-x)));
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

  function getSqrtTsAndPvs(uint timestamp, uint expiry, int rate) internal view virtual returns(uint s, uint p) {
    uint tAnnualised = expiry > timestamp ? (expiry - timestamp).decimalDiv(SECONDS_PER_YEAR) : 0;
    s = sqrt(tAnnualised * ONE);
    p = exp(-rate.decimalMul(int(tAnnualised)));
  }
}
