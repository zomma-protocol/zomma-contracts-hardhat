//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "./interfaces/IChainlink.sol";
import "./utils/Timestamp.sol";

contract SpotPricer is Timestamp {
  mapping(uint => uint) public settledPrices;
  IChainlink public oracle;
  bool public initialized;

  event SettlePrice(uint expiry, uint price, uint roundId);

  // should be chainlink proxy
  function initialize(address _oracle) public virtual {
    require(!initialized, "already initialized");
    initialized = true;
    oracle = IChainlink(_oracle);
  }

  function settle(uint expiry, uint _roundId) external {
    require(settledPrices[expiry] == 0, "settled");
    require(checkRoundId(expiry, _roundId), "invalid roundId");
    uint price = uint(oracle.getAnswer(_roundId)) * 10**18 / 10**oracle.decimals();
    settledPrices[expiry] = price;
    emit SettlePrice(expiry, price, _roundId);
  }

  function getPrice() public view virtual returns (uint) {
    return uint(oracle.latestAnswer()) * 10**18 / 10**oracle.decimals();
  }

  function checkRoundId(uint expiry, uint _roundId) internal view virtual returns (bool) {
    uint timestamp = oracle.getTimestamp(_roundId);
    uint timestamp2 = oracle.getTimestamp(_roundId + 1);
    timestamp2 = timestamp2 == 0 ? getTimestamp() : timestamp2;
    return timestamp > 0 && expiry >= timestamp && expiry < timestamp2;
  }

  uint256[47] private __gap;
}
