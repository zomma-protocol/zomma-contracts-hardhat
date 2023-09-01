//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IChainlink.sol";

contract InterimChainlink is IChainlink, Ownable {
  uint private constant ANSWER_MASK =    0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff;
  uint private constant ROUND_ID_MASK =  0x0000000000ffffffffffffffffffffff00000000000000000000000000000000;

  uint8 public decimals;
  uint public outdatedPeriod = 3600;
  uint private latest;

  mapping(uint80 => uint) private histories;

  event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

  constructor(uint8 _decimals) {
    decimals = _decimals;
  }

  function setOutdatedPeriod(uint _outdatedPeriod) external payable onlyOwner {
    outdatedPeriod = _outdatedPeriod;
  }

  function submit(int256 _submission, uint80 _roundId, uint _updatedAt, bool addToHistory) external payable onlyOwner {
    if (_roundId > latestRound()) {
      latest = (_updatedAt << 208) | (uint(_roundId) << 128) | uint(_submission);
    }
    if (addToHistory) {
      setHistory(_submission, _roundId, _updatedAt);
    }
    emit AnswerUpdated(_submission, _roundId, _updatedAt);
  }

  function setHistory(int256 _submission, uint80 _roundId, uint _updatedAt) public payable onlyOwner {
    require(histories[_roundId] == 0, 'submitted');
    histories[_roundId] = (_updatedAt << 208) | uint(_submission);
  }

  function getRoundData(uint80 _roundId) external view returns (
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) {
    uint data = histories[_roundId];
    roundId = _roundId;
    answer = int(data & ANSWER_MASK);
    startedAt = data >> 208;
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
    startedAt = (latest >> 208);
    require(startedAt >= block.timestamp || block.timestamp - startedAt < outdatedPeriod, 'outdated');
    updatedAt = startedAt;
    answer = int(latest & ANSWER_MASK);
    roundId = latestRound();
    answeredInRound = roundId;
  }

  function latestRound() public view returns (uint80) {
    return uint80((latest & ROUND_ID_MASK) >> 128);
  }
}
