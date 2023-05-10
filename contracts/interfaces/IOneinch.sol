//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

interface IOneinch {
  function getRate(address srcToken, address dstToken, bool useWrappers) external view returns (uint256 weightedRate);
}
