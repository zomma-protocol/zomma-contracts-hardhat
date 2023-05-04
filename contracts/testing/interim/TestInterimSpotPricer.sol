//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../../interim/InterimSpotPricer.sol";
import "../TestVault.sol";

contract TestInterimSpotPricer is InterimSpotPricer {
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
}
