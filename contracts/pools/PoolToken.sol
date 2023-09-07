//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract PoolToken is ERC20("", "") {
  string private _name2;
  string private _symbol2;
  address public pool;
  bool public initialized;

  error NotPool();

  modifier onlyPool() {
    if (msg.sender != pool) {
      revert NotPool();
    }
    _;
  }

  function initialize(address pool_, string calldata name_, string calldata symbol_) external {
    require(!initialized, "already initialized");
    initialized = true;
    pool = pool_;
    _name2 = name_;
    _symbol2 = symbol_;
  }

  function mint(address account, uint amount) external payable onlyPool {
    _mint(account, amount);
  }

  function burn(address account, uint amount) external payable onlyPool {
    _burn(account, amount);
  }

  function name() public view override returns (string memory) {
    return _name2;
  }

  function symbol() public view override returns (string memory) {
    return _symbol2;
  }
}
