//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../SpotPricer.sol";

contract InterimSpotPricer is SpotPricer, Ownable {
  bool public migrated;

  // should be chainlink proxy
  function migrate(address _oracle) external onlyOwner {
    require(!migrated, "already migrated");
    require(_oracle != address(oracle), "unchanged");
    oracle = IChainlink(_oracle);
    require(oracle.latestAnswer() != 0, 'incorrect interface');
    migrated = true;
  }

  function checkRoundId(uint expiry, uint _roundId) internal view override returns (bool) {
    if (migrated) {
      return super.checkRoundId(expiry, _roundId);
    } else {
      uint timestamp = oracle.getTimestamp(_roundId);
      uint timestamp2 = oracle.getTimestamp(_roundId + 1);
      return timestamp > 0 && expiry >= timestamp && expiry < timestamp2;
    }
  }
}
