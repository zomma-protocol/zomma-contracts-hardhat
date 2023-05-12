//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../../pools/PoolFactory.sol";
import "../../pools/PoolToken.sol";
import "./AppendPool.sol";

contract AppendPoolFactory is PoolFactory {
  constructor() {
    pool = new AppendPool();
    poolToken = new PoolToken();
  }
}
