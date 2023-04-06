//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../OptionMarket.sol";
import "./TestVault.sol";

contract TestOptionMarket is OptionMarket {
  TestVault private vault;

  function setVault(address _vault) external {
    vault = TestVault(_vault);
  }

  function getTimestamp() internal view override returns (uint) {
    return vault.getTimestampPublic();
  }
}
