//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

interface IRewardCollector {
  function rewards() external view returns (uint);
  function token() external view returns (address);
  function claim(uint amount) external;
}
