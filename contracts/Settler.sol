//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "./Vault.sol";

contract Settler {
  function settle(address vault, uint expiry, address[] calldata accounts) external {
    for (uint i = 0; i < accounts.length; ++i) {
      Vault(vault).settle(accounts[i], expiry);
    }
  }
}
