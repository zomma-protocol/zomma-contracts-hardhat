//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../SpotPricer.sol";

contract InterimSpotPricer is SpotPricer {
  bool public migrated;

  // should be chainlink proxy
  function migrate(address _oracle) external payable onlyOwner {
    require(!migrated, "already migrated");
    require(_oracle != address(oracle), "unchanged");
    oracle = IChainlink(_oracle);
    (, int256 answer, , ,) = oracle.latestRoundData();
    require(answer != 0, 'incorrect interface');
    migrated = true;
  }
}
