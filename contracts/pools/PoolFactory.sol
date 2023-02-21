//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./Pool.sol";
import "./PoolToken.sol";

contract PoolFactory {
  using Clones for address;

  Pool private pool;
  PoolToken private poolToken;

  event Create(address pool, address poolToken);

  constructor() {
    pool = new Pool();
    poolToken = new PoolToken();
  }

  function create(address _vault, string memory name, string memory symbol) external returns(address clonedPool, address clonedPoolToken) {
    clonedPoolToken = address(poolToken).clone();
    clonedPool = address(pool).clone();

    PoolToken(clonedPoolToken).initialize(clonedPool, name, symbol);
    Pool(clonedPool).initialize(_vault, clonedPoolToken, msg.sender);

    emit Create(clonedPool, clonedPoolToken);
  }
}
