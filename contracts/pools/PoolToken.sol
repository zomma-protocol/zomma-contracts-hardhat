//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract PoolToken is ERC20("", "") {
  string private _name;
  string private _symbol;
  address public pool;
  bool public initialized;

  modifier onlyPool() {
    require(msg.sender == pool, "only pool");
    _;
  }

  function initialize(address pool_, string memory name_, string memory symbol_) external {
    require(!initialized, "already initialized");
    initialized = true;
    pool = pool_;
    _name = name_;
    _symbol = symbol_;
  }

  function mint(address account, uint amount) external onlyPool {
    _mint(account, amount);
  }

  function burn(address account, uint amount) external onlyPool {
    _burn(account, amount);
  }

  function name() public view override returns (string memory) {
    return _name;
  }

  function symbol() public view override returns (string memory) {
    return _symbol;
  }
}
