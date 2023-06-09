//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "./OptionPricer.sol";

// iv is actually option price in signed data
contract SignedOptionPricer is OptionPricer {
  function getPrice(bool isCall, uint expiry, uint timeToExpirySec, uint volatility, uint spot, uint strike, int rate) public view override returns (uint) {
    return volatility;
  }

  function checkIv(uint iv) internal pure override {
  }
}
