//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../black-scholes/SqrtTsAndPvs.sol";
import "../black-scholes/CacheBlackScholes.sol";
import "./OptionPricer.sol";
import "../Config.sol";

contract CacheOptionPricer is OptionPricer, CacheBlackScholes {
  Config public config;
  bool public initialized;

  function initialize(address _config) external {
    require(!initialized, "already initialized");
    initialized = true;
    config = Config(_config);
  }

  function updateLookup(uint[] calldata expiries) external {
    int riskFreeRate = config.riskFreeRate();
    uint time = getTimestamp();
    for (uint i = 0; i < expiries.length; ++i) {
      internalUpdateLookup(time, expiries[i], riskFreeRate);
    }
  }

  function getSqrtTsAndPvs(uint timestamp, uint expiry, int rate) internal view virtual override(SqrtTsAndPvs, CacheBlackScholes) returns(uint s, uint p) {
    return super.getSqrtTsAndPvs(timestamp, expiry, rate);
  }
}
