//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../SpotPricer.sol";

/**
 * @dev Spot price includes in signed data, this contract is used for settle only.
 */
contract SignedSpotPricer is SpotPricer {
  function setOracle(address _oracle) external onlyOwner {
    oracle = IChainlink(_oracle);
  }

  function settleByOwner(uint expiry, uint price) external onlyOwner {
    if (settledPrices[expiry] != 0) {
      revert Settled();
    }
    settledPrices[expiry] = price;
    emit SettlePrice(expiry, price, 0);
  }

  function checkRoundId(uint /* expiry */, uint80 /* _roundId */) internal pure override returns (bool) {
    return false;
  }
}
