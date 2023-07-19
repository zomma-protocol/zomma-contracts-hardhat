//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../libraries/SafeDecimalMath.sol";
import "../libraries/SignedSafeDecimalMath.sol";
import "./BlackScholes.sol";

contract CacheBlackScholes is BlackScholes {
  mapping(uint => uint) public sqrtTs;
  mapping(uint => uint) public pvs;

  event UpdateLookup(uint expiry, uint sqrtTs, uint pvs);

  function internalUpdateLookup(uint timestamp, uint expiry, int rate) internal {
    (uint s, uint p) = super.getSqrtTsAndPvs(timestamp, expiry, rate);
    sqrtTs[expiry] = s;
    pvs[expiry] = p;
    emit UpdateLookup(expiry, s, p);
  }

  function getSqrtTsAndPvs(uint /* timestamp */, uint expiry, int /* rate */) internal view virtual override returns(uint s, uint p) {
    return (sqrtTs[expiry], pvs[expiry]);
  }

  uint256[48] private __gap;
}
