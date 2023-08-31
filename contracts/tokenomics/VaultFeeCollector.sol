//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "./IRewardCollector.sol";
import "../Vault.sol";
import "../Config.sol";

contract VaultFeeCollector is IRewardCollector {
  using SafeERC20 for IERC20;
  address public esZma;
  Vault public vault;

  constructor(address _esZma, address _vault) {
    esZma = _esZma;
    vault = Vault(_vault);
  }

  modifier onlyEsZma() {
    require(esZma == msg.sender, "only esZMA");
    _;
  }

  function rewards() external view returns (uint) {
    int balance = vault.balanceOf(address(this));
    return balance < 0 ? 0 : uint(balance);
  }

  function token() public view returns (address) {
    return Config(vault.config()).quote();
  }

  function claim(uint amount) external onlyEsZma {
    vault.withdraw(amount);
    IERC20(token()).safeTransfer(esZma, amount);
  }
}
