//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

contract Timestamp {
  function getTimestamp() internal view virtual returns (uint) {
    return block.timestamp;
  }
}
