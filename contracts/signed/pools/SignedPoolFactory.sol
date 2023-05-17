//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../../pools/PoolFactory.sol";
import "../../pools/PoolToken.sol";
import "./SignedPool.sol";

contract SignedPoolFactory is PoolFactory {
  constructor() {
    pool = new SignedPool();
    poolToken = new PoolToken();
  }
}
