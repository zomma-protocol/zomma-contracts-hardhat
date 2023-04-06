//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../Vault.sol";
import "./PythSpotPricer.sol";

contract PythVault is Vault {
  function pythWithdraw(uint amount, bytes[] calldata priceUpdateData) external {
    updatePrice(priceUpdateData);
    withdraw(amount);
  }

  function pythWithdrawPercent(uint rate, uint acceptableAmount, uint freeWithdrawableRate, bytes[] calldata priceUpdateData) external returns (uint) {
    updatePrice(priceUpdateData);
    return withdrawPercent(rate, acceptableAmount, freeWithdrawableRate);
  }

  function pythTrade(uint expiry, uint strike, bool isCall, int size, uint acceptableTotal, bytes[] calldata priceUpdateData) external {
    updatePrice(priceUpdateData);
    trade(expiry, strike, isCall, size, acceptableTotal);
  }

  function pythSettle(address account, uint expiry, bytes[] calldata priceUpdateData) public {
    updatePrice(priceUpdateData);
    settle(account, expiry);
  }

  function pythLiquidate(
    address account,
    uint expiry,
    uint strike,
    bool isCall,
    int size,
    bytes[] calldata priceUpdateData
  ) external returns (int) {
    updatePrice(priceUpdateData);
    return liquidate(account, expiry, strike, isCall, size);
  }

  function pythClear(address account, bytes[] calldata priceUpdateData) external {
    updatePrice(priceUpdateData);
    clear(account);
  }

  function updatePrice(bytes[] calldata priceUpdateData) internal {
    PythSpotPricer(address(spotPricer)).update(priceUpdateData);
  }
}
