//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../../option-pricer/CacheOptionPricer.sol";
import "../TestVault.sol";

contract TestCacheOptionPricer is CacheOptionPricer {
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
