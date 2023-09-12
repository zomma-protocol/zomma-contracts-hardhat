//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

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

  function pythTrade(int[] calldata data, uint deadline, bytes[] calldata priceUpdateData) external {
    updatePrice(priceUpdateData);
    trade(data, deadline);
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

  function updatePrice(bytes[] calldata priceUpdateData) public {
    PythSpotPricer(address(spotPricer)).update(priceUpdateData);
  }
}
