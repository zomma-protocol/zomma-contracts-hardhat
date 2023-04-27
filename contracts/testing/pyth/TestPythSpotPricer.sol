//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../../pyth/PythSpotPricer.sol";
import "./TestPythVault.sol";

contract TestPythSpotPricer is SpotPricer {
  uint internal price;
  TestPythVault internal vault;

  function reinitialize(address _chainlink) external {
    chainlink = IChainlink(_chainlink);
  }

  function setVault(address _vault) external {
    vault = TestPythVault(_vault);
  }

  function setSettledPrice(uint expiry, uint _price) external {
    settledPrices[expiry] = _price;
  }

  function setPrice(uint _price) external {
    price = _price;
  }

  function getPrice() external view override returns (uint) {
    if (price == 0 && address(chainlink) != address(0)) {
      return uint(chainlink.latestAnswer()) * 10**18 / 10**chainlink.decimals();
    }
    return price;
  }

  function getTimestamp() internal view override returns (uint) {
    return vault.getTimestampPublic();
  }
}
