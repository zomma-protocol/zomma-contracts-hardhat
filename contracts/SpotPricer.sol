//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "./interfaces/IChainlink.sol";
import "./utils/Timestamp.sol";

/**
 * @dev Spot price oracle, original version uses chainlink.
 */
contract SpotPricer is Timestamp {
  mapping(uint => uint) public settledPrices;
  IChainlink public oracle;
  bool public initialized;
  uint public validPeriod;
  uint public maxPrice;
  uint public minPrice;

  event SettlePrice(uint expiry, uint price, uint roundId);

  error AlreadyInitialized();
  error Settled();
  error InvalidRoundId();
  error StalePrice();
  error AboveMaxPrice();
  error BelowMinPrice();

  /**
  * @dev Initalize method. Can call only once.
  * @param _oracle: Should be chainlink proxy address.
  */
  function initialize(address _oracle) public virtual {
    if (initialized) {
      revert AlreadyInitialized();
    }
    initialized = true;
    validPeriod = 3600; // 1 hour
    maxPrice = type(uint).max;
    minPrice = 1;
    oracle = IChainlink(_oracle);
  }

  /**
  * @dev Set a settled price. Can only can once per expiry.
  * @param expiry: Expiry timestamp to settle.
  * @param roundId: The roundId is most close to this expiry. It must be last roundId before expired.
  */
  function settle(uint expiry, uint80 roundId) external {
    if (settledPrices[expiry] != 0) {
      revert Settled();
    }
    if (!checkRoundId(expiry, roundId)) {
      revert InvalidRoundId();
    }
    (, int256 answer, , , ) = oracle.getRoundData(roundId);
    uint price = uint(answer) * 10**18 / 10**oracle.decimals();
    validatePrice(price);
    settledPrices[expiry] = price;
    emit SettlePrice(expiry, price, roundId);
  }

  /**
  * @dev Set a settled price, can only can once per expiry.
  * @return spotPrice: Spot price. In decimals 18.
  */
  function getPrice() public view virtual returns (uint) {
    (, int256 answer, , uint updatedAt, ) = oracle.latestRoundData();
    if (getTimestamp() > updatedAt + validPeriod) {
      revert StalePrice();
    }
    uint price = uint(answer) * 10**18 / 10**oracle.decimals();
    validatePrice(price);
    return price;
  }

  function checkRoundId(uint expiry, uint80 roundId) internal view virtual returns (bool) {
    (, , , uint updatedAt, ) = oracle.getRoundData(roundId);
    (, , , uint updatedAt2, ) = oracle.getRoundData(roundId + 1);
    return updatedAt > 0 && expiry >= updatedAt && expiry < updatedAt2;
  }

  function validatePrice(uint price) internal view {
    if (price > maxPrice) {
      revert AboveMaxPrice();
    }
    if (price < minPrice) {
      revert BelowMinPrice();
    }
  }

  uint256[44] private __gap;
}
