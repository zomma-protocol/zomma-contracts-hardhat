//SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/utils/math/SignedSafeMath.sol";

library SignedSafeDecimalMath {
  using SignedSafeMath for int;

  uint8 public constant PRECISION = 18;
  int public constant UNIT = int(10**uint(PRECISION));

  function decimalMul(int x, int y) internal pure returns (int) {
    return x * y / UNIT;
  }

  function decimalMulRound(int x, int y) internal pure returns (int) {
    int quotientTimesTen = x.mul(y) / (UNIT / 10);

    if (quotientTimesTen % 10 >= 5) {
      quotientTimesTen += 10;
    }

    return quotientTimesTen / 10;
  }

  function decimalMulRoundUp(int x, int y) internal pure returns (int) {
    int quotientTimesTen = x.mul(y) / (UNIT / 10);

    if (quotientTimesTen % 10 > 0) {
      quotientTimesTen += 10;
    } else if (quotientTimesTen % 10 < 0) {
      quotientTimesTen -= 10;
    }

    return quotientTimesTen / 10;
  }

  function decimalDiv(int x, int y) internal pure returns (int) {
    return x * UNIT / y;
  }

  function decimalDivRound(int x, int y) internal pure returns (int) {
    int resultTimesTen = x.mul(UNIT * 10).div(y);

    if (resultTimesTen % 10 >= 5) {
      resultTimesTen += 10;
    }

    return resultTimesTen / 10;
  }

  function decimalDivRoundUp(int x, int y) internal pure returns (int) {
    int resultTimesTen = x.mul(UNIT * 10).div(y);

    if (resultTimesTen % 10 > 0) {
      resultTimesTen += 10;
    }

    return resultTimesTen / 10;
  }

  function toDecimal(int i) internal pure returns (int) {
    return i.mul(UNIT);
  }

  function fromDecimal(int i) internal pure returns (int) {
    int quotientTimesTen = i / (UNIT / 10);

    if (quotientTimesTen % 10 >= 5) {
      quotientTimesTen += 10;
    }

    return quotientTimesTen / 10;
  }

  function abs(int x) internal pure returns (uint) {
    return uint(x < 0 ? -x : x);
  }
}
