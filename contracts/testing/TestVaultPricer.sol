//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "./TestVault.sol";
import "../VaultPricer.sol";

contract TestVaultPricer is VaultPricer {
  function getTimestamp() internal view override returns (uint) {
    return TestVault(address(vault)).getTimestampPublic();
  }
}
