//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "./Vault.sol";

contract VaultOwner is OwnableUpgradeable, AccessControlUpgradeable {
  using SafeERC20 for IERC20;
  using Address for address;
  using Address for address payable;

  // 0x872340a532bdd7bb02bea115c1b0f1ba87eac982f5b79b51ac189ffaac1b6fce
  bytes32 private constant TRADER_ROLE = keccak256("TRADER");

  // 0xeb33521169e672634fcae38dcc3bab0be8a080072000cfbdc0e041665d727c18
  bytes32 private constant LIQUIDATOR_ROLE = keccak256("LIQUIDATOR");

  address public vault;

  fallback() external {
    bytes memory ret;
    bytes4 selector = msg.sig;
    if (selector == Vault.tradeBySignature.selector) {
      ret = roleCall(TRADER_ROLE);
    } else if (selector == Vault.trade.selector || selector == Vault.liquidate.selector || selector == Vault.deposit.selector) {
      ret = roleCall(LIQUIDATOR_ROLE);
    } else {
      ret = ownerCall();
    }
    assembly {
      return(add(ret, 0x20), mload(ret))
    }
  }

  function initialize(address _vault) external initializer {
    __Ownable_init();
    _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    vault = _vault;
    internalApproveVault();
  }

  function withdrawToken(address _token) external payable onlyOwner {
    IERC20(_token).safeTransfer(msg.sender, IERC20(_token).balanceOf(address(this)));
  }

  function withdraw() external payable onlyOwner {
    payable(msg.sender).sendValue(address(this).balance);
  }

  function approveVault() external payable onlyOwner {
    internalApproveVault();
  }

  function ownerCall() private onlyOwner returns(bytes memory) {
    return vault.functionCall(msg.data);
  }

  function roleCall(bytes32 role) private onlyRole(role) returns(bytes memory)  {
    return vault.functionCall(msg.data);
  }

  function internalApproveVault() private {
    Config config = Vault(vault).config();
    IERC20(config.quote()).forceApprove(vault, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
  }
}
