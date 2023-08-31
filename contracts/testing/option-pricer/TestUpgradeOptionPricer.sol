//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../../option-pricer/CacheOptionPricer.sol";
import "../TestVault.sol";

contract TestUpgradeOptionPricer is OptionPricer {
  // deprecated
  mapping(uint => uint) public sqrtTs;
  mapping(uint => uint) public pvs;
  uint256[48] private __gap;
  Config public config;
  bool public initialized;
  TestVault private vault;
}
