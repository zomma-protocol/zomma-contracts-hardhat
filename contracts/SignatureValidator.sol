//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/cryptography/EIP712Upgradeable.sol";

/**
 * @dev Validate signature of SignedVault.
 */
contract SignatureValidator is OwnableUpgradeable, EIP712Upgradeable {
  mapping(address => mapping(uint => uint)) public usedNonces;

  event UseNonce(address account, uint nonce);

  error InvalidSignature();
  error UsedNonce();

  constructor() {
    _disableInitializers();
  }

  function initialize() external initializer {
    __Ownable_init();
    __EIP712_init("SignatureValidator", "1");
  }

  function useNonce(uint nonce) external {
    internalUseNonce(msg.sender, nonce);
  }

  function recoverAndUseNonce(bytes calldata aheadEncodedData, uint nonce, uint8 v, bytes32 r, bytes32 s) external returns(address signer) {
    bytes32 structHash = keccak256(abi.encodePacked(aheadEncodedData, nonce));
    signer = recover(structHash, v, r, s);
    internalUseNonce(signer, nonce);
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

  function internalUseNonce(address account, uint nonce) private {
    if (usedNonces[account][nonce] != 0) {
      revert UsedNonce();
    }
    usedNonces[account][nonce] = 1;
    emit UseNonce(account, nonce);
  }
}
