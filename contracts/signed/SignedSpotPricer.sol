//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../SpotPricer.sol";

/**
 * @dev Spot price includes in signed data, this contract is used for settle only.
 */
contract SignedSpotPricer is SpotPricer, OwnableUpgradeable {
  function initialize(address _oracle) public override {
    super.initialize(_oracle);
    _transferOwnership(msg.sender);
  }

  function setOracle(address _oracle) external onlyOwner {
    oracle = IChainlink(_oracle);
  }

  function settleByOwner(uint expiry, uint price) external onlyOwner {
    require(settledPrices[expiry] == 0, "settled");
    settledPrices[expiry] = price;
    emit SettlePrice(expiry, price, 0);
  }

  function checkRoundId(uint /* expiry */, uint /* _roundId */) internal pure override returns (bool) {
    return false;
  }
}
