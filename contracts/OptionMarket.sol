//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

contract OptionMarket {
  // [expiry][strike]
  mapping(uint => mapping(uint => uint)) internal markets;
  mapping(uint => bool) public expiryDisabled;
  bool public tradeDisabled;

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

  function internalSetIv(uint[] calldata data) internal {
    uint length = data.length;
    require(length % 2 == 0, 'invalid length');
    for (uint i = 0; i < length; i += 2) {
      uint datum = data[i];
      uint market = data[i + 1];
      uint expiry = datum & EXPIRY_MASK;
      uint strike = (datum & STRIKE_MASK) >> 40;
      markets[expiry][strike] = market;
      emit SetIv(expiry, strike, market);
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
