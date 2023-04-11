//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IChainlink.sol";

contract InterimChainlink is IChainlink, Ownable {
  uint private constant ANSWER_MASK =    0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff;
  uint private constant ROUND_ID_MASK =  0x0000000000ffffffffffffffffffffff00000000000000000000000000000000;
  // uint private constant TIMESTAMP_MASK = 0xffffffffff000000000000000000000000000000000000000000000000000000;

  uint8 public decimals;
  uint private latest;
  uint public outdatedPeriod = 3600;

  mapping(uint => uint) private histories;

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

  constructor(uint8 _decimals) {
    decimals = _decimals;
  }

  function setOutdatedPeriod(uint _outdatedPeriod) external onlyOwner {
    outdatedPeriod = _outdatedPeriod;
  }

  function submit(int256 _submission, uint _roundId, uint _updatedAt, bool addToHistory) external onlyOwner {
    if (_roundId > roundId()) {
      latest = (_updatedAt << 216) | (_roundId << 128) | uint(_submission);
    }
    if (addToHistory) {
      setHistory(_submission, _roundId, _updatedAt);
    }
    emit AnswerUpdated(_submission, _roundId, _updatedAt);
  }

  function setHistory(int256 _submission, uint _roundId, uint _updatedAt) public onlyOwner {
    require(histories[_roundId] == 0, 'submitted');
    histories[_roundId] = (_updatedAt << 216) | uint(_submission);
  }

  function latestAnswer() external view returns (int) {
    uint updatedAt = (latest >> 216);
    require(updatedAt >= block.timestamp || block.timestamp - updatedAt < outdatedPeriod, 'outdated');
    return int(latest & ANSWER_MASK);
  }

  function roundId() public view returns (uint) {
    return (latest & ROUND_ID_MASK) >> 128;
  }

  function getAnswer(uint _roundId) external view returns (int256) {
    return int(histories[_roundId] & ANSWER_MASK);
  }

  function getTimestamp(uint _roundId) external view returns (uint256) {
    return histories[_roundId] >> 216;
  }
}
