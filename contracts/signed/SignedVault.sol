//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../Vault.sol";

/**
 * @dev Signed data version contract. Spot price and ivs includes in singed data.
 */
contract SignedVault is Vault {
  using SafeDecimalMath for uint;

  uint private constant BUY_CALL_IV_MASK =   0x00000000000000000000000000000000000000000000000000ffffffffffffff;
  uint private constant SELL_CALL_IV_MASK =  0x000000000000000000000000000000000000ffffffffffffff00000000000000;
  uint private constant BUY_PUT_IV_MASK =    0x0000000000000000000000ffffffffffffff0000000000000000000000000000;
  uint private constant SELL_PUT_IV_MASK =   0x00000000ffffffffffffff000000000000000000000000000000000000000000;
  uint private constant BUY_CALL_DISABLED =  0x0001000000000000000000000000000000000000000000000000000000000000;
  uint private constant SELL_CALL_DISABLED = 0x0010000000000000000000000000000000000000000000000000000000000000;
  uint private constant BUY_PUT_DISABLED =   0x0100000000000000000000000000000000000000000000000000000000000000;
  uint private constant SELL_PUT_DISABLED =  0x1000000000000000000000000000000000000000000000000000000000000000;

  error SignatureExpired();
  error InvalidSignature();
  error InvalidMarket();

  function initTxCache() internal view override returns (TxCache memory) {
    TxCache memory txCache = super.initTxCache();
    (txCache.data, txCache.spot) = extractData();
    txCache.spotInitialMarginRiskRate = txCache.spot.decimalMul(txCache.initialMarginRiskRate);
    return txCache;
  }

  function getIv(TxCache memory txCache, uint expiry, uint strike, bool isCall, bool isBuy) internal pure override returns (uint) {
    uint market = getMarket(txCache, expiry, strike);
    return market == 0 ? 0 : getMarketIv(market, isCall, isBuy);
  }

  function isIvOutdated(uint) internal pure override returns (bool) {
    return false;
  }

  function isMarketDisabled(TxCache memory txCache, uint expiry, uint strike, bool isCall, bool isBuy) internal pure override returns (bool) {
    uint market = getMarket(txCache, expiry, strike);
    uint disabled;
    if (isCall) {
      disabled = isBuy ? BUY_CALL_DISABLED : SELL_CALL_DISABLED;
    } else {
      disabled = isBuy ? BUY_PUT_DISABLED : SELL_PUT_DISABLED;
    }
    return (market & disabled) == disabled;
  }

  function getSpotPrice() internal pure override returns (uint) {
    return 0;
  }

  /**
  * @dev Signed data is appended in tx data. Format is:
  *      v: 32 bytes. Owner signature.
  *      r: 32 bytes. Owner signature.
  *      s: 32 bytes. Owner signature.
  *      validTime: 32 bytes. When signature will expire.
  *      marketData: Dynamic bytes. Market data array, including iv and disabled status. 32 bytes for each item.
  *                  One market has two items. First item includes expiry and strike. Second item includes iv and disabled status.
  *      spotPrice: 32 bytes. Spot price.
  *      dataLength: 32 bytes. How many data slot of signed data. 32 bytes for each data slot. It will be 5 + item length of marketData.
  */
  function extractData() internal view returns (uint[] memory, uint) {
    (uint dataLength, uint v, bytes32 r, bytes32 s, uint validTime, uint[] memory data, uint spot) = getData();
    if (getTimestamp() > validTime) {
      revert SignatureExpired();
    }
    bytes32 hash = keccak256(abi.encodePacked(validTime, data, spot, dataLength));
    if(ecrecover(keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hash)), uint8(v), r, s) != owner) {
      revert InvalidSignature();
    }
    return (data, spot);
  }

  function getData() internal pure returns (uint dataLength, uint v, bytes32 r, bytes32 s, uint validTime, uint[] memory data, uint spot) {
    dataLength = getDataLength();
    uint dataBytes = 32 * dataLength;
    data = new uint[](dataLength - 6);
    assembly {
      v := calldataload(sub(calldatasize(), dataBytes))
      r := calldataload(add(sub(calldatasize(), dataBytes), 32))
      s := calldataload(add(sub(calldatasize(), dataBytes), 64))
      validTime := calldataload(add(sub(calldatasize(), dataBytes), 96))
      calldatacopy(add(data, 32), add(sub(calldatasize(), dataBytes), 128), sub(dataBytes, 160))
      spot := calldataload(sub(calldatasize(), 64))
    }
  }

  function getDataLength() internal pure returns (uint) {
    uint dataLength;
    assembly {
      dataLength := calldataload(sub(calldatasize(), 32))
    }
    return dataLength;
  }

  function getMarketIv(uint market, bool isCall, bool isBuy) internal pure returns (uint) {
    uint mask;
    uint shift;
    if (isCall) {
      (mask, shift) = isBuy ? (BUY_CALL_IV_MASK, 0) : (SELL_CALL_IV_MASK, 56);
    } else {
      (mask, shift) = isBuy ? (BUY_PUT_IV_MASK, 112) : (SELL_PUT_IV_MASK, 168);
    }
    // compressed iv decimal is 8
    return ((market & mask) >> shift) * 10**10;
  }

  function getMarket(TxCache memory txCache, uint expiry, uint strike) internal pure returns (uint) {
    uint target = strike << 40 | expiry;
    for (uint i = 0; i < txCache.data.length; i += 2) {
      if (txCache.data[i] == target) {
        return txCache.data[i + 1];
      }
    }
    revert InvalidMarket();
  }
}
