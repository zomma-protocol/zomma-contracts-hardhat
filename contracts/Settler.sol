//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "./Vault.sol";

contract Settler {
  function settle(address vault, uint expiry, address[] calldata accounts) external {
    uint length = accounts.length;
    for (uint i; i < length;) {
      Vault(vault).settle(accounts[i], expiry);
      unchecked { ++i; }
    }
  }
}
