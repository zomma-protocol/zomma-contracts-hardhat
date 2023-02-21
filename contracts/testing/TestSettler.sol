//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../Settler.sol";

contract TestSettler is Settler {
  function reinitialize(address _vault) external {
    initialized = true;
    vault = Vault(_vault);
  }
}
