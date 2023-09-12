//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../SignatureValidator.sol";

contract TestSignatureValidator is SignatureValidator {
  function _disableInitializers() internal override {
  }
}
