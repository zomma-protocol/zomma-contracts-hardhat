//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./utils/Timestamp.sol";

/**
 * @dev Market status. Markets will be useless if using SignedVault, only tradeDisabled and expiryDisabled are used in SignedVault.
 */
contract OptionMarket is OwnableUpgradeable, Timestamp {
  // [expiry][strike]
  mapping(uint => mapping(uint => uint)) internal markets;
  mapping(uint => bool) public expiryDisabled;
  bool public tradeDisabled;
  uint public lastUpdatedAt;

  uint private constant EXPIRY_MASK =        0x000000000000000000000000000000000000000000000000000000ffffffffff;
  uint private constant STRIKE_MASK =        0xffffffffffffffffffffffffffffffffffffffffffffffffffffff0000000000;
  uint private constant BUY_CALL_IV_MASK =   0x00000000000000000000000000000000000000000000000000ffffffffffffff;
  uint private constant SELL_CALL_IV_MASK =  0x000000000000000000000000000000000000ffffffffffffff00000000000000;
  uint private constant BUY_PUT_IV_MASK =    0x0000000000000000000000ffffffffffffff0000000000000000000000000000;
  uint private constant SELL_PUT_IV_MASK =   0x00000000ffffffffffffff000000000000000000000000000000000000000000;
  uint private constant BUY_CALL_DISABLED =  0x0001000000000000000000000000000000000000000000000000000000000000;
  uint private constant SELL_CALL_DISABLED = 0x0010000000000000000000000000000000000000000000000000000000000000;
  uint private constant BUY_PUT_DISABLED =   0x0100000000000000000000000000000000000000000000000000000000000000;
  uint private constant SELL_PUT_DISABLED =  0x1000000000000000000000000000000000000000000000000000000000000000;

  event SetIv(uint expiry, uint strike, uint market);
  event TradeDisabled(bool disabled);
  event ExpiryDisabled(uint expiry, bool disabled);

  function initialize() external initializer {
    __Ownable_init();
  }

  // owner methods

  function setIv(uint[] calldata data) external payable onlyOwner {
    internalSetIv(data);
    lastUpdatedAt = getTimestamp();
  }

  function setTradeDisabled(bool _tradeDisabled) external payable onlyOwner {
    tradeDisabled = _tradeDisabled;
    emit TradeDisabled(_tradeDisabled);
  }

  function setExpiryDisabled(uint expiry, bool _disabled) external payable onlyOwner {
    expiryDisabled[expiry] = _disabled;
    emit ExpiryDisabled(expiry, _disabled);
  }

  // end of owner

  function internalSetIv(uint[] calldata data) internal {
    uint length = data.length;
    require(length % 2 == 0, 'invalid length');
    unchecked {
      for (uint i; i < length; i +=2) {
        uint datum = data[i];
        uint market = data[i + 1];
        uint expiry = datum & EXPIRY_MASK;
        uint strike = (datum & STRIKE_MASK) >> 40;
        markets[expiry][strike] = market;
        emit SetIv(expiry, strike, market);
      }
    }
  }

  function isMarketDisabled(uint expiry, uint strike, bool isCall, bool isBuy) public view returns (bool) {
    uint disabled;
    if (isCall) {
      disabled = isBuy ? BUY_CALL_DISABLED : SELL_CALL_DISABLED;
    } else {
      disabled = isBuy ? BUY_PUT_DISABLED : SELL_PUT_DISABLED;
    }
    return (markets[expiry][strike] & disabled) == disabled;
  }

  // compressed iv decimal 8
  function getMarketIv(uint expiry, uint strike, bool isCall, bool isBuy) public view returns (uint) {
    uint mask;
    uint shift;
    if (isCall) {
      (mask, shift) = isBuy ? (BUY_CALL_IV_MASK, 0) : (SELL_CALL_IV_MASK, 56);
    } else {
      (mask, shift) = isBuy ? (BUY_PUT_IV_MASK, 112) : (SELL_PUT_IV_MASK, 168);
    }
    return ((markets[expiry][strike] & mask) >> shift) * 10**10;
  }
}
