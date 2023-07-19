//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

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

  function setAddresses(uint _offset, address _oracle, address _srcToken, address _dstToken) external onlyOwner {
    offset = _offset;
    oracle = _oracle;
    srcToken = _srcToken;
    dstToken = _dstToken;
  }

  function setHistory(int256 _submission, uint _roundId, uint _updatedAt) public onlyOwner {
    require(histories[_roundId] == 0, 'submitted');
    histories[_roundId] = (_updatedAt << 216) | uint(_submission);
  }

  function latestAnswer() external view returns (int) {
    return int(IOneinch(oracle).getRate(srcToken, dstToken, true) * offset);
  }

  function roundId() public pure returns (uint) {
    return 0;
  }

  function getAnswer(uint _roundId) external view returns (int256) {
    return int(histories[_roundId] & ANSWER_MASK);
  }

  function getTimestamp(uint _roundId) external view returns (uint256) {
    return histories[_roundId] >> 216;
  }
}
