//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "./Vault.sol";

contract Settler {
  Vault public vault;
  bool public initialized;

  function initialize(address _vault) external {
    require(!initialized, "already initialized");
    initialized = true;
    vault = Vault(_vault);
  }

  function settle(uint expiry, address[] calldata accounts) external {
    for (uint i = 0; i < accounts.length; ++i) {
      vault.settle(accounts[i], expiry);
    }
  }
}
