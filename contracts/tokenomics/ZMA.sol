//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";

contract ZMA is IERC20, ERC20Burnable {
  constructor() ERC20('ZOMMA Token', 'ZMA') {
    _mint(msg.sender, 200_000_000 * 10**decimals());
  }

  function decimals() public view override returns (uint8) {
    return 18;
  }
}
