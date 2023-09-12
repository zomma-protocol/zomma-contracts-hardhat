//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

/**
 * @dev Validate signature of SignedVault.
 */
contract SignatureValidator is OwnableUpgradeable, EIP712Upgradeable {
  mapping(address => mapping(uint => uint)) public usedNonces;

  error InvalidSignature();
  error UsedNonce();

  constructor() {
    _disableInitializers();
  }

  function initialize() external initializer {
    __Ownable_init();
    __EIP712_init("SignatureValidator", "1");
  }

  function cancelNonce(uint nonce) external  {
    if (usedNonces[msg.sender][nonce] == 0) {
      usedNonces[msg.sender][nonce] = 1;
    }
  }

  function recoverAndUseNonce(bytes32 structHash, uint8 v, bytes32 r, bytes32 s, uint nonce) external returns(address signer) {
    signer = recover(structHash, v, r, s);
    if (usedNonces[signer][nonce] != 0) {
      revert UsedNonce();
    }
    usedNonces[signer][nonce] = 1;
  }

  function recover(bytes32 structHash, uint8 v, bytes32 r, bytes32 s) public view returns(address) {
    bytes32 digest = _hashTypedDataV4(structHash);
    return ECDSAUpgradeable.recover(digest, v ,r ,s);
  }

  function verifySignature(bytes32 structHash, uint8 v, bytes32 r, bytes32 s) external view {
    address signer = recover(structHash, v ,r ,s);
    if (signer != owner()) {
      revert InvalidSignature();
    }
  }
}
