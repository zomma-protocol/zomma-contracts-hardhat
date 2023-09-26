//SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IVault {
  struct PositionParams {
    uint expiry;
    uint strike;
    bool isCall;
    int size;
    int notional;
  }

  struct TxCache {
    uint now;
    uint spot;
    int riskFreeRate;
    uint initialMarginRiskRate;
    uint spotInitialMarginRiskRate;
    uint priceRatio;
    uint priceRatio2;
    uint priceRatioUtilization;
    uint spotFee;
    uint optionFee;
    uint minPremium;
    uint exerciseFeeRate;
    uint profitFeeRate;
    uint poolProportion;
    uint poolLength;
    address[10] pools;
    bool[10] loaded;
    int[10] available;
    int[10] adjustedAvailable;
    int[10] equity;
    uint[] data;
    bool isTraderClosing;
    bool skipCheckOwner;
  }

  struct TradingPoolsInfo {
    int totalEquity;
    int totalAvailable;
    int totalAdjustedAvailable;
    int totalSize;
    int[10] rates;
    uint[10] indexes;
    uint length;
    bool isClose;
  }

  struct AccountInfo {
    uint initialMargin;
    int marginBalance;
    int equity;
    int equityWithFee;
    int upnl;
    int available;
    int healthFactor;
  }
}
