//SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

interface IChainlink {
  function decimals() external view returns (uint8);
  function latestAnswer() external view returns (int256);
  function getAnswer(uint _roundId) external view returns (int256);
  function getTimestamp(uint _roundId) external view returns (uint256);
}
