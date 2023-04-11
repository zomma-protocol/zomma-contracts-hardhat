//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "./interfaces/IChainlink.sol";
import "./utils/Timestamp.sol";

contract SpotPricer is Timestamp {
  mapping(uint => uint) public settledPrices;
  IChainlink public chainlink;
  bool public initialized;

  event SettlePrice(uint expiry, uint price, uint roundId);

  function initialize(address _chainlink) external {
    require(!initialized, "already initialized");
    initialized = true;
    chainlink = IChainlink(_chainlink);
  }

  function settle(uint expiry, uint _roundId) external {
    require(settledPrices[expiry] == 0, "settled");
    checkRoundId(expiry, _roundId);
    uint price = uint(chainlink.getAnswer(_roundId)) * 10**18 / 10**chainlink.decimals();
    settledPrices[expiry] = price;
    emit SettlePrice(expiry, price, _roundId);
  }

  function getPrice() external view virtual returns (uint) {
    return uint(chainlink.latestAnswer()) * 10**18 / 10**chainlink.decimals();
  }

  function checkRoundId(uint expiry, uint _roundId) internal view virtual {
    uint timestamp = chainlink.getTimestamp(_roundId);
    uint timestamp2 = chainlink.getTimestamp(_roundId + 1);
    timestamp2 = timestamp2 == 0 ? getTimestamp() : timestamp2;
    require(timestamp > 0 && expiry >= timestamp && expiry < timestamp2, "invalid roundId");
  }
}
