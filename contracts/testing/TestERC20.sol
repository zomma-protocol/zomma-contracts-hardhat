//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract TestERC20 is IERC20, ERC20 {
  uint8 internal decimals2;

  constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
    decimals2 = decimals_;
  }

  function mint(address account, uint amount) external {
    _mint(account, amount);
  }

  function burn(address account, uint amount) external {
    _burn(account, amount);
  }

  function decimals() public view override returns (uint8) {
    return decimals2;
  }
}
