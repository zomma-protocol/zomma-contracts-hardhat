//SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

library SafeDecimalMath {
  uint8 private constant PRECISION = 18;
  uint private constant UNIT = 10**uint(PRECISION);

  function decimalMul(uint x, uint y) internal pure returns (uint) {
    return x * y / UNIT;
  }

  // function decimalMulRound(uint x, uint y) internal pure returns (uint) {
  //   uint quotientTimesTen = x.mul(y) / (UNIT / 10);

  //   if (quotientTimesTen % 10 >= 5) {
  //     quotientTimesTen += 10;
  //   }

  //   return quotientTimesTen / 10;
  // }

  function decimalDiv(uint x, uint y) internal pure returns (uint) {
    return x * UNIT / y;
  }

  // function decimalDivRound(uint x, uint y) internal pure returns (uint) {
  //   uint resultTimesTen = x.mul(UNIT * 10).div(y);

  //   if (resultTimesTen % 10 >= 5) {
  //     resultTimesTen += 10;
  //   }

  //   return resultTimesTen / 10;
  // }

  // function toDecimal(uint i) internal pure returns (uint) {
  //   return i.mul(UNIT);
  // }

  // function fromDecimal(uint i) internal pure returns (uint) {
  //   uint quotientTimesTen = i / (UNIT / 10);

  //   if (quotientTimesTen % 10 >= 5) {
  //     quotientTimesTen += 10;
  //   }

  //   return quotientTimesTen / 10;
  // }

  function truncate(uint x, uint y) internal pure returns (uint) {
    if (PRECISION > y) {
      uint n = 10**(PRECISION - y);
      return x / n * n;
    } else {
      return x;
    }
  }
}
