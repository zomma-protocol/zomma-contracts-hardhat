//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./Pool.sol";
import "./PoolToken.sol";

contract PoolFactory {
  using Clones for address;

  Pool internal pool;
  PoolToken internal poolToken;

  event Create(address pool, address poolToken);

  constructor() {
    pool = new Pool();
    poolToken = new PoolToken();
  }

  function create(address _vault, string calldata name, string calldata symbol, bytes32 salt) external returns(address clonedPool, address clonedPoolToken) {
    bytes32 hash = keccak256(abi.encodePacked(msg.sender, salt));
    clonedPoolToken = address(poolToken).cloneDeterministic(hash);
    clonedPool = address(pool).cloneDeterministic(hash);

    PoolToken(clonedPoolToken).initialize(clonedPool, name, symbol);
    Pool(clonedPool).initialize(_vault, clonedPoolToken, msg.sender);

    emit Create(clonedPool, clonedPoolToken);
  }
}
