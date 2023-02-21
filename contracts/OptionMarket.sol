//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

contract OptionMarket {
  // [expiry][strike][isCall][isBuy]
  mapping(uint => mapping(uint => mapping(bool => mapping(bool => uint)))) internal markets;
  mapping(uint => bool) public expiryDisabled;
  bool public tradeDisabled;

  uint private constant EXPIRY_MASK =    0x000000000000000000000000000000000000000000000000000000ffffffffff;
  uint private constant STRIKE_MASK =    0x000000000000000000000000000000ffffffffffffffffffffffff0000000000;
  uint private constant IV_MASK =        0x000000ffffffffffffffffffffffff0000000000000000000000000000000000;
  uint private constant DISABLED =       0x1000000000000000000000000000000000000000000000000000000000000000;
  uint private constant IS_CALL =        0x0100000000000000000000000000000000000000000000000000000000000000;
  uint private constant IS_BUY =         0x0010000000000000000000000000000000000000000000000000000000000000;
  uint private constant MARKET_IV_MASK = 0x0fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff;

  event SetIv(uint expiry, uint strike, bool isCall, bool isBuy, uint iv, bool disabled);

  function internalSetIv(uint[] memory data) internal {
    uint length = data.length;
    for (uint i = 0; i < length; ++i) {
      uint datum = data[i];
      bool disabled = (datum & DISABLED) == DISABLED;
      bool isCall = (datum & IS_CALL) == IS_CALL;
      bool isBuy = (datum & IS_BUY) == IS_BUY;
      uint expiry = datum & EXPIRY_MASK;
      uint strike = (datum & STRIKE_MASK) >> 40;
      uint iv = (datum & IV_MASK) >> 136;
      markets[expiry][strike][isCall][isBuy] = disabled ? (iv | DISABLED) : iv;
      emit SetIv(expiry, strike, isCall, isBuy, iv, disabled);
    }
  }

  function isMarketDisabled(uint expiry, uint strike, bool isCall, bool isBuy) public view returns (bool) {
    return (markets[expiry][strike][isCall][isBuy] & DISABLED) == DISABLED;
  }

  function getMarketIv(uint expiry, uint strike, bool isCall, bool isBuy) public view returns (uint) {
    return markets[expiry][strike][isCall][isBuy] & MARKET_IV_MASK;
  }
}
