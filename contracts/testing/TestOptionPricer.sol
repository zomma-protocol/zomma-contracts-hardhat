//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../OptionPricer.sol";
import "./TestVault.sol";

contract TestOptionPricer is OptionPricer {
  TestVault private vault;

  function reinitialize(address _config, address _vault) external {
    initialized = true;
    config = Config(_config);
    vault = TestVault(_vault);
  }

  function setVault(address _vault) external {
    vault = TestVault(_vault);
  }

  function getTimestamp() internal view override returns (uint) {
    return vault.getTimestampPublic();
  }
}
