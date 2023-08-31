//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

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
    uint length = expiries.length;
    for (uint i; i < length; ) {
      internalUpdateLookup(time, expiries[i], riskFreeRate);
      unchecked { ++i; }
    }
  }

  function getSqrtTsAndPvs(uint timestamp, uint expiry, int rate) internal view virtual override(SqrtTsAndPvs, CacheBlackScholes) returns(uint s, uint p) {
    return super.getSqrtTsAndPvs(timestamp, expiry, rate);
  }
}
