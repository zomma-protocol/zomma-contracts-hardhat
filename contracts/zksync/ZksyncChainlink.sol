//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IChainlink.sol";

// temporary chainlink alternate
contract ZksyncChainlink is IChainlink, Ownable {
  int public latestAnswer;
  uint8 public decimals;
  uint public roundId;
  mapping(uint256 => int256) private answers;
  mapping(uint256 => uint256) private timestamps;

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

  constructor(uint8 _decimals) {
    decimals = _decimals;
  }

  function submit(int256 _submission, uint _roundId, uint _updatedAt) external onlyOwner {
    require(roundId == 0 || roundId + 1 == _roundId, "invalid roundId");
    internalSubmit(_submission, _roundId, _updatedAt);
    roundId = _roundId;
    latestAnswer = _submission;
  }

  function batchSubmit(int256[] calldata _submissions, uint[] calldata _roundIds, uint[] calldata _updatedAts) external onlyOwner {
    require(_submissions.length == _roundIds.length && _roundIds.length == _updatedAts.length, "invalid inputs");
    uint tmpRoundId = roundId;
    for (uint i = 0; i < _submissions.length; ++i) {
      uint _roundId = _roundIds[i];
      require(tmpRoundId == 0 || tmpRoundId + 1 == _roundId, "invalid roundId");
      internalSubmit(_submissions[i], _roundId, _updatedAts[i]);
      tmpRoundId = _roundId;
    }
    roundId = tmpRoundId;
    latestAnswer = _submissions[_submissions.length - 1];
  }

  function getAnswer(uint _roundId) external view returns (int256) {
    return answers[_roundId];
  }

  function getTimestamp(uint _roundId) external view returns (uint256) {
    return timestamps[_roundId];
  }

  function internalSubmit(int256 _submission, uint _roundId, uint _updatedAt) internal {
    answers[_roundId] = _submission;
    timestamps[_roundId] = _updatedAt;
    emit AnswerUpdated(_submission, _roundId, _updatedAt);
  }
}
