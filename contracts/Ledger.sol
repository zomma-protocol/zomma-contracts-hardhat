//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "./libraries/SafeDecimalMath.sol";
import "./libraries/SignedSafeDecimalMath.sol";

contract Ledger {
  using SafeDecimalMath for uint;
  using SignedSafeDecimalMath for int;

  enum ChangeType{ Trade, Settle, Liquidate, Clear }

  struct Position {
    int size;
    int notional;
  }

  mapping(address => int) public balanceOf;
  mapping(address => uint[]) internal accountExpiries;
  mapping(address => mapping(uint => uint[])) internal accountStrikes;

  // [account][expiry][strike][isCall]
  mapping(address => mapping(uint => mapping(uint => mapping(bool => Position)))) internal accountPositions;

  event PositionUpdate(address account, uint expiry, uint strike, bool isCall, int size, int notional, int fee, ChangeType changeType, int realized);

  function listOfExpiries(address account) public view returns (uint[] memory) {
    return accountExpiries[account];
  }

  function listOfStrikes(address account, uint expiry) public view returns (uint[] memory) {
    return accountStrikes[account][expiry];
  }

  function positionOf(address account, uint expiry, uint strike, bool isCall) public view returns (Position memory) {
    return accountPositions[account][expiry][strike][isCall];
  }

  function positionSizeOf(address account, uint expiry, uint strike, bool isCall) public view returns (int) {
    return positionOf(account, expiry, strike, isCall).size;
  }

  function internalUpdatePosition(address account, uint expiry, uint strike, bool isCall, int size, int notional, int fee, ChangeType changeType) internal returns (int) {
    Position memory position = positionOf(account, expiry, strike, isCall);
    if (position.size == 0) {
      initStrike(account, expiry, strike);
    }

    int oSize = position.size;
    int realized = 0;
    if (position.size > 0 && size < 0 || position.size < 0 && size > 0) {
      int absSize = int(position.size.abs());
      int absTradeSize = int(size.abs());
      if (absSize == absTradeSize) {
        realized = notional + position.notional;
      } else if (absSize < absTradeSize) {
        realized = notional.decimalMul(absSize).decimalDiv(absTradeSize) + position.notional;
      } else {
        realized = position.notional.decimalMul(absTradeSize).decimalDiv(absSize) + notional;
      }
    }
    notional -= realized;
    position.size += size;
    position.notional += notional;
    balanceOf[account] += realized + fee;
    emit PositionUpdate(account, expiry, strike, isCall, size, notional, fee, changeType, realized);
    accountPositions[account][expiry][strike][isCall] = position;
    if (position.size == 0) {
      clearStrike(account, expiry, strike);
    }

    // increased sell size
    return (position.size > 0 ? int(0) : position.size) - (oSize > 0 ? int(0) : oSize);
  }

  function internalClearPosition(address account, uint expiry, uint strike, bool isCall, int realized, int fee, ChangeType changeType) internal returns (int size, int notional) {
    if (positionSizeOf(account, expiry, strike, isCall) != 0) {
      Position memory position = positionOf(account, expiry, strike, isCall);
      size = position.size;
      notional = position.notional;
      accountPositions[account][expiry][strike][isCall] = Position(0, 0);
      emit PositionUpdate(account, expiry, strike, isCall, -position.size, -position.notional, fee, changeType, realized);
      clearStrike(account, expiry, strike);
    }
  }

  function initStrike(address account, uint expiry, uint strike) internal {
    if (anyStrike(account, expiry)) {
      if (anyPosition(account, expiry, strike)) {
        return;
      } else {
        accountStrikes[account][expiry].push(strike);
      }
    } else {
      accountStrikes[account][expiry].push(strike);
      accountExpiries[account].push(expiry);
    }
  }

  function clearStrike(address account, uint expiry, uint strike) internal {
    if (!anyPosition(account, expiry, strike)) {
      removeStrike(account, expiry, strike);
      if (!anyStrike(account, expiry))  {
        removeExpiry(account, expiry);
      }
    }
  }

  function removeStrike(address account, uint expiry, uint strike) internal {
    uint[] memory strikes = listOfStrikes(account, expiry);
    uint length = strikes.length;
    for (uint i = 0; i < length; i++) {
      if (strikes[i] == strike) {
        accountStrikes[account][expiry][i] = strikes[length - 1];
        accountStrikes[account][expiry].pop();
        return;
      }
    }
  }

  function removeExpiry(address account, uint expiry) internal {
    uint[] memory expiries = listOfExpiries(account);
    uint length = expiries.length;
    for (uint i = 0; i < length; i++) {
      if (expiries[i] == expiry) {
        accountExpiries[account][i] = expiries[length - 1];
        accountExpiries[account].pop();
        return;
      }
    }
  }

  function anyStrike(address account, uint expiry) internal view returns (bool) {
    return listOfStrikes(account, expiry).length > 0;
  }

  function anyPosition(address account, uint expiry, uint strike) internal view returns (bool) {
    return positionSizeOf(account, expiry, strike, true) != 0 || positionSizeOf(account, expiry, strike, false) != 0;
  }

  uint256[46] private __gap;
}
