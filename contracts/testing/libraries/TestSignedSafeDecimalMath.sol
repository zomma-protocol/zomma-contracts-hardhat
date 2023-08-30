//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../../libraries/SignedSafeDecimalMath.sol";

contract TestSignedSafeDecimalMath {
  using SignedSafeDecimalMath for int;

  function decimalDivRound(int x, int y) external pure returns (int) {
    return x.decimalDivRound(y);
  }
}
