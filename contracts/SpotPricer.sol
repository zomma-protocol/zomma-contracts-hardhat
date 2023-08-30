//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "./interfaces/IChainlink.sol";
import "./utils/Timestamp.sol";

/**
 * @dev Spot price oracle, original version uses chainlink.
 */
contract SpotPricer is Timestamp {
  mapping(uint => uint) public settledPrices;
  IChainlink public oracle;
  bool public initialized;

  event SettlePrice(uint expiry, uint price, uint roundId);

  /**
  * @dev Initalize method. Can call only once.
  * @param _oracle: Should be chainlink proxy address.
  */
  function initialize(address _oracle) public virtual {
    require(!initialized, "already initialized");
    initialized = true;
    oracle = IChainlink(_oracle);
  }

  /**
  * @dev Set a settled price. Can only can once per expiry.
  * @param expiry: Expiry timestamp to settle.
  * @param roundId: The roundId is most close to this expiry. It must be last roundId before expired.
  */
  function settle(uint expiry, uint80 roundId) external {
    require(settledPrices[expiry] == 0, "settled");
    require(checkRoundId(expiry, roundId), "invalid roundId");
    (, int256 answer, , , ) = oracle.getRoundData(roundId);
    uint price = uint(answer) * 10**18 / 10**oracle.decimals();
    settledPrices[expiry] = price;
    emit SettlePrice(expiry, price, roundId);
  }

  /**
  * @dev Set a settled price, can only can once per expiry.
  * @return spotPrice: Spot price. In decimals 18.
  */
  function getPrice() public view virtual returns (uint) {
    (, int256 answer, , , ) = oracle.latestRoundData();
    return uint(answer) * 10**18 / 10**oracle.decimals();
  }

  function checkRoundId(uint expiry, uint80 roundId) internal view virtual returns (bool) {
    (, , uint startedAt, , ) = oracle.getRoundData(roundId);
    (, , uint startedAt2, , ) = oracle.getRoundData(roundId + 1);
    return startedAt > 0 && expiry >= startedAt && expiry < startedAt2;
  }

  uint256[47] private __gap;
}
