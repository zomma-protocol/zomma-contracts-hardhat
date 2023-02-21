//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../interfaces/IChainlink.sol";

contract TestChainlink is IChainlink {
  int public latestAnswer;
  uint8 public decimals = 8;
  uint public roundId;
  mapping(uint256 => int256) private answers;
  mapping(uint256 => uint256) private timestamps;
  uint private timestamp;

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

  function submit(int256 _submission) external {
    uint _roundId = ++roundId;
    latestAnswer = _submission;
    answers[_roundId] = _submission;
    uint time = getNow();
    timestamps[_roundId] = time;
    emit AnswerUpdated(_submission, _roundId, time);
  }

  function getAnswer(uint _roundId) external view returns (int256) {
    return answers[_roundId];
  }

  function getTimestamp(uint _roundId) external view returns (uint256) {
    return timestamps[_roundId];
  }

  function setNow(uint _timestamp) external {
    timestamp = _timestamp;
  }

  function setDecimals(uint8 _decimals) external {
    decimals = _decimals;
  }

  function getNow() private view returns (uint) {
    if (timestamp == 0) {
      return block.timestamp;
    } else {
      return timestamp;
    }
  }
}
