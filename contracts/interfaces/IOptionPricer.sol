//SPDX-License-Identifier: MIT
pragma solidity ^0.8.11;

interface IOptionPricer {
  struct GetPremiumParams {
    uint now;
    uint spot;
    int riskFreeRate;
    uint initialMarginRiskRate;
    uint spotFee;
    uint optionFee;
    uint minPremium;
    uint expiry;
    uint strike;
    uint iv;
    int size;
    int available;
    int equity;
    uint priceRatio;
    uint priceRatio2;
    uint priceRatioUtilization;
    bool isCall;
  }

  function getPremium(GetPremiumParams calldata params) external view returns (int, int);
}
