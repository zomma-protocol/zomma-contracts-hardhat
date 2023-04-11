//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../SpotPricer.sol";

contract InterimSpotPricer is SpotPricer, Ownable {
  bool public migrated;

  function migrate(address _chainlink) external onlyOwner {
    require(!migrated, "already migrated");
    migrated = true;
    chainlink = IChainlink(_chainlink);
  }

  function checkRoundId(uint expiry, uint _roundId) internal view override {
    uint timestamp = chainlink.getTimestamp(_roundId);
    uint timestamp2 = chainlink.getTimestamp(_roundId + 1);
    require(timestamp > 0 && expiry >= timestamp && expiry < timestamp2, "invalid roundId");
  }
}
