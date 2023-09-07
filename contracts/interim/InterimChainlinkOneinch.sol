//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../interfaces/IChainlink.sol";
import "../interfaces/IOneinch.sol";

contract InterimChainlinkOneinch is IChainlink, Ownable {
  uint private constant ANSWER_MASK =    0x00000000000000000000000000000000ffffffffffffffffffffffffffffffff;

  uint8 public decimals;
  uint public offset;
  address public oracle;
  address public srcToken;
  address public dstToken;
  mapping(uint => uint) private histories;

  constructor(uint8 _decimals) {
    decimals = _decimals;
  }

  function setAddresses(uint _offset, address _oracle, address _srcToken, address _dstToken) external payable onlyOwner {
    offset = _offset;
    oracle = _oracle;
    srcToken = _srcToken;
    dstToken = _dstToken;
  }

  function setHistory(int256 _submission, uint _roundId, uint _updatedAt) public payable onlyOwner {
    require(histories[_roundId] == 0, 'submitted');
    histories[_roundId] = (_updatedAt << 216) | uint(_submission);
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
    startedAt = data >> 216;
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
    answer = int(IOneinch(oracle).getRate(srcToken, dstToken, true) * offset);
  }

  function latestRound() public pure returns (uint) {
    return 0;
  }
}
