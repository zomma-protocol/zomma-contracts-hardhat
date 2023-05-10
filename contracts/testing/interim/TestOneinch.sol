//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

contract TestOneinch {
  uint public weightedRate;

  function setRate(uint _weightedRate) external {
    weightedRate = _weightedRate;
  }

  function getRate(address srcToken, address dstToken, bool useWrappers) external view returns (uint256) {
    return weightedRate;
  }
}
