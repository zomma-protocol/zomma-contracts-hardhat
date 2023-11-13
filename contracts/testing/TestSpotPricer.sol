//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../SpotPricer.sol";
import "./TestVault.sol";

contract TestSpotPricer is SpotPricer {
  uint internal price;
  TestVault internal vault;

  function reinitialize(address _oracle) external {
    oracle = IChainlink(_oracle);
  }

  function setVault(address _vault) external {
    vault = TestVault(_vault);
  }

  function setSettledPrice(uint expiry, uint _price) external {
    settledPrices[expiry] = _price;
  }

  function setPrice(uint _price) external {
    price = _price;
  }

  function getPrice() public view override returns (uint) {
    if (price == 0 && address(oracle) != address(0)) {
      return super.getPrice();
    }
    return price;
  }

  function getTimestamp() internal view override returns (uint) {
    return vault.getTimestampPublic();
  }

  function setValidPeriod(uint _validPeriod) external {
    validPeriod = _validPeriod;
  }

  function setMaxPrice(uint _maxPrice) external {
    maxPrice = _maxPrice;
  }

  function setMinPrice(uint _minPrice) external {
    minPrice = _minPrice;
  }
}
