//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";

contract PoolToken is OwnableUpgradeable, ERC20Upgradeable {
  address public pool;

  error NotPool();

  modifier onlyPool() {
    if (msg.sender != pool) {
      revert NotPool();
    }
    _;
  }

  function initialize(address pool_, string calldata name_, string calldata symbol_) external initializer {
    __Ownable_init();
    __ERC20_init(name_, symbol_);
    pool = pool_;
  }

  function mint(address account, uint amount) external payable onlyPool {
    _mint(account, amount);
  }

  function burn(address account, uint amount) external payable onlyPool {
    _burn(account, amount);
  }

  uint[49] private __gap;
}
