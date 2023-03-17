//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "./EscrowedZMA.sol";

contract EscrowedZMARewarder is ERC20 {
  using SafeERC20 for IERC20;

  address public zma;
  address public escrowedZma;

  constructor(address _zma, address _escrowedZma) ERC20('Escrowed ZOMMA Rewarder', 'esZMARewarder') {
    zma = _zma;
    escrowedZma = _escrowedZma;
  }

  function decimals() public view override returns (uint8) {
    return 18;
  }

  function _transfer(address from, address to, uint256 amount) internal virtual override {
    IERC20(zma).safeTransferFrom(from, address(this), amount);
    EscrowedZMA(escrowedZma).stakeFor(amount, to);
  }
}
