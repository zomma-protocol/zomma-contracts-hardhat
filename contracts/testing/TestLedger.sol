//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../Ledger.sol";

contract TestLedger is Ledger {
  uint public timestamp;

  function setBalance(address account, int balance) external {
    balanceOf[account] = balance;
  }

  function updatePosition(address account, uint expiry, uint strike, bool isCall, int size, int notional, int fee, ChangeType changeType) external returns (int) {
    return internalUpdatePosition(account, expiry, strike, isCall, size, notional, fee, changeType);
  }

  function clearPosition(address account, uint expiry, uint strike, bool isCall, int realized, int fee, ChangeType changeType) external returns (int size, int notional) {
    return internalClearPosition(account, expiry, strike, isCall, realized, fee, changeType);
  }
}
