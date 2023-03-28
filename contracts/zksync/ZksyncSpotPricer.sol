//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "../SpotPricer.sol";

contract ZksyncSpotPricer is SpotPricer, Ownable {
  bool public migrated;

  function migrate(address _chainlink) external onlyOwner {
    require(!migrated, "already migrated");
    migrated = true;
    chainlink = IChainlink(_chainlink);
  }
}
