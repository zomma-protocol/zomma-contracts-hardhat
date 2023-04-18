//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../SpotPricer.sol";

contract InterimSpotPricer is SpotPricer, Ownable {
  bool public migrated;

  // should be chainlink proxy
  function migrate(address _chainlink) external onlyOwner {
    require(!migrated, "already migrated");
    require(_chainlink != address(chainlink), "unchanged");
    chainlink = IChainlink(_chainlink);
    require(chainlink.latestAnswer() != 0, 'incorrect interface');
    migrated = true;
  }

  function checkRoundId(uint expiry, uint _roundId) internal view override returns (bool) {
    if (migrated) {
      return super.checkRoundId(expiry, _roundId);
    } else {
      uint timestamp = chainlink.getTimestamp(_roundId);
      uint timestamp2 = chainlink.getTimestamp(_roundId + 1);
      return timestamp > 0 && expiry >= timestamp && expiry < timestamp2;
    }
  }
}
