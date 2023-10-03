//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../../pools/Pool.sol";
import "../TestVault.sol";

contract TestPool is Pool {
  function getTimestamp() internal view override returns (uint) {
    return TestVault(address(vault)).getTimestampPublic();
  }
}
