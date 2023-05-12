//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../Vault.sol";

contract AppendVault is Vault {
  uint private constant BUY_CALL_IV_MASK =   0x00000000000000000000000000000000000000000000000000ffffffffffffff;
  uint private constant SELL_CALL_IV_MASK =  0x000000000000000000000000000000000000ffffffffffffff00000000000000;
  uint private constant BUY_PUT_IV_MASK =    0x0000000000000000000000ffffffffffffff0000000000000000000000000000;
  uint private constant SELL_PUT_IV_MASK =   0x00000000ffffffffffffff000000000000000000000000000000000000000000;

  error SignatureExpired();
  error InvalidSignature();

  function initTxCache() internal view override returns (TxCache memory) {
    TxCache memory txCache = super.initTxCache();
    txCache.data = extractData();
    return txCache;
  }

  function getIv(TxCache memory txCache, uint expiry, uint strike, bool isCall, bool isBuy) internal view override returns (uint) {
    uint target = strike << 40 | expiry;
    for (uint i = 0; i < txCache.data.length; i += 2) {
      if (txCache.data[i] == target) {
        return getMarketIv(txCache.data[i + 1], isCall, isBuy);
      }
    }
    return 0;
  }

  function isIvOutdated(uint timestamp) internal view override returns (bool) {
    return false;
  }

  function extractData() internal view returns (uint[] memory) {
    (uint lastData, uint v, bytes32 r, bytes32 s, uint validTime, uint[] memory data) = getData();
    if (getTimestamp() > validTime) {
      revert SignatureExpired();
    }
    bytes32 hash = keccak256(abi.encodePacked(validTime, data, lastData));
    if(ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)), uint8(v), r, s) != owner) {
      revert InvalidSignature();
    }
    return data;
  }

  function getData() internal pure returns (uint lastData, uint v, bytes32 r, bytes32 s, uint validTime, uint[] memory data) {
    lastData = getLastData();
    uint leng = 32 * lastData;
    data = new uint[](lastData - 5);
    assembly {
      v := calldataload(sub(calldatasize(), leng))
      r := calldataload(add(sub(calldatasize(), leng), 32))
      s := calldataload(add(sub(calldatasize(), leng), 64))
      validTime := calldataload(add(sub(calldatasize(), leng), 96))
      calldatacopy(add(data, 32), add(sub(calldatasize(), leng), 128), sub(leng, 160))
    }
  }

  function getLastData() internal pure returns (uint) {
    uint lastData;
    assembly {
      lastData := calldataload(sub(calldatasize(), 32))
    }
    return lastData;
  }

  function getMarketIv(uint market, bool isCall, bool isBuy) internal pure returns (uint) {
    uint mask;
    uint shift;
    if (isCall) {
      (mask, shift) = isBuy ? (BUY_CALL_IV_MASK, 0) : (SELL_CALL_IV_MASK, 56);
    } else {
      (mask, shift) = isBuy ? (BUY_PUT_IV_MASK, 112) : (SELL_PUT_IV_MASK, 168);
    }
    return ((market & mask) >> shift) * 10**10;
  }
}
