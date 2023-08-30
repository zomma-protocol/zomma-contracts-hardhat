//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../interfaces/IChainlink.sol";

contract TestChainlink is IChainlink {
  int public latestAnswer;
  uint8 public decimals;
  uint80 public latestRound;
  mapping(uint80 => int256) private answers;
  mapping(uint80 => uint256) private timestamps;
  uint private timestamp;

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

  constructor(uint8 _decimals) {
    decimals = _decimals;
  }

  function submit(int256 _submission) external {
    uint80 _roundId = ++latestRound;
    latestAnswer = _submission;
    answers[_roundId] = _submission;
    uint time = getNow();
    timestamps[_roundId] = time;
    emit AnswerUpdated(_submission, _roundId, time);
  }

  function getRoundData(uint80 _roundId) external view returns (
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) {
    roundId = _roundId;
    answer = answers[_roundId];
    startedAt = timestamps[_roundId];
    updatedAt = startedAt;
    answeredInRound = _roundId;
  }

  function latestRoundData() external view returns (
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) {
    roundId = latestRound;
    answeredInRound = roundId;
    startedAt = timestamps[roundId];
    updatedAt = startedAt;
    answer = answers[roundId];
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
