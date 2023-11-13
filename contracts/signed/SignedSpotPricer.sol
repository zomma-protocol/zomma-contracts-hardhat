//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

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

  function setValidPeriod(uint _validPeriod) external onlyOwner {
    validPeriod = _validPeriod;
  }

  function setMaxPrice(uint _maxPrice) external onlyOwner {
    maxPrice = _maxPrice;
  }

  function setMinPrice(uint _minPrice) external onlyOwner {
    minPrice = _minPrice;
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
