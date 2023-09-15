//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import "./Vault.sol";

contract VaultOwner is OwnableUpgradeable, AccessControlUpgradeable {
  using AddressUpgradeable for address;

  // 0x872340a532bdd7bb02bea115c1b0f1ba87eac982f5b79b51ac189ffaac1b6fce
  bytes32 private constant TRADER_ROLE = keccak256("TRADER");

  address public vault;

  function initialize(address _vault) external initializer {
    vault = _vault;
    _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
    _setupRole(TRADER_ROLE, msg.sender);
  }

  fallback() external {
    bytes memory ret;
    bytes4 selector = msg.sig;
    if (selector == Vault.tradeBySignature.selector) {
      ret = roleCall(TRADER_ROLE);
    } else {
      ret = ownerCall();
    }
    assembly {
      return(add(ret, 0x20), mload(ret))
    }
  }

  function ownerCall() private onlyOwner returns(bytes memory) {
    return vault.functionCall(msg.data);
  }

  function roleCall(bytes32 role) private onlyRole(role) returns(bytes memory)  {
    return vault.functionCall(msg.data);
  }
}
