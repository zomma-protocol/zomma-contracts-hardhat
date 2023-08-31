//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@pythnetwork/pyth-sdk-solidity/IPyth.sol";
import "@pythnetwork/pyth-sdk-solidity/PythStructs.sol";
import "../utils/Timestamp.sol";

contract PythSpotPricer is Timestamp {
  mapping(uint => uint) public settledPrices;
  IPyth public oracle;
  bytes32 public priceID;

  event SettlePrice(uint expiry, uint price, uint roundId);

  function initialize(address _oracle, bytes32 _priceID) external {
    require(address(oracle) == address(0), "already initialized");
    oracle = IPyth(_oracle);
    priceID = _priceID;
  }

  function settle(uint expiry, bytes[] calldata priceUpdateData) external payable {
    require(settledPrices[expiry] == 0, "settled");
    bytes32[] memory priceIds = new bytes32[](1);
    priceIds[0] = priceID;
    uint fee = oracle.getUpdateFee(priceUpdateData);
    PythStructs.PriceFeed[] memory priceFeeds = oracle.parsePriceFeedUpdates{ value: fee }(priceUpdateData, priceIds, uint64(expiry), uint64(expiry) + 5);
    uint price = pythPriceToPrice(priceFeeds[0].price);
    require(priceFeeds[0].price.publishTime == expiry, 'invalid publishTime');
    settledPrices[expiry] = price;
    emit SettlePrice(expiry, price, 0);
    if (msg.value - fee > 0) {
      payable(msg.sender).transfer(msg.value - fee);
    }
  }

  function update(bytes[] calldata priceUpdateData) external payable {
    uint fee = oracle.getUpdateFee(priceUpdateData);
    oracle.updatePriceFeeds{ value: fee }(priceUpdateData);
    if (msg.value - fee > 0) {
      payable(msg.sender).transfer(msg.value - fee);
    }
  }

  function getPrice() public view virtual returns (uint) {
    PythStructs.Price memory price = oracle.getPrice(priceID);
    return pythPriceToPrice(price);
  }

  function pythPriceToPrice(PythStructs.Price memory price) internal pure returns (uint) {
    uint p = uint(uint64(price.price)) * 10**18;
    return price.expo > 0 ? p * 10**(uint32(price.expo)) : p / 10**(uint32(-price.expo));
  }
}
