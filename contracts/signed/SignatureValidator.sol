//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

/**
 * @dev Validate signature of SignedVault.
 */
contract SignatureValidator is OwnableUpgradeable, EIP712Upgradeable {
  error InvalidSignature();

  constructor() {
    _disableInitializers();
  }

  function initialize() external initializer {
    __Ownable_init();
    __EIP712_init("SignatureValidator", "1");
  }

  function verifySignature(bytes32 structHash, uint8 v, bytes32 r, bytes32 s) external view {
    bytes32 digest = _hashTypedDataV4(structHash);
    address signer = ECDSAUpgradeable.recover(digest, v ,r ,s);
    if (signer != owner()) {
      revert InvalidSignature();
    }
  }
}
