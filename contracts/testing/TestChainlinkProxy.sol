//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "./TestChainlink.sol";

contract TestChainlinkProxy {
  uint16 public phaseId = 1;
  TestChainlink public aggregator;

  uint256 constant private PHASE_OFFSET = 64;

  function setChainlink(address _aggregator) external {
    aggregator = TestChainlink(_aggregator);
  }

  function setPhaseId(uint16 _phaseId) external {
    phaseId = _phaseId;
  }

  function decimals() external view returns (uint8) {
    return aggregator.decimals();
  }

  function getRoundData(uint80 _roundId) external view returns (
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) {
    (, uint64 aggregatorRoundId) = parseIds(_roundId);
    return aggregator.getRoundData(aggregatorRoundId);
  }

  function latestRoundData() external view returns (
    uint80 roundId,
    int256 answer,
    uint256 startedAt,
    uint256 updatedAt,
    uint80 answeredInRound
  ) {
    return aggregator.latestRoundData();
  }

  function parseIds(uint256 _roundId) internal pure returns (uint16, uint64) {
    uint16 pid = uint16(_roundId >> PHASE_OFFSET);
    uint64 aggregatorRoundId = uint64(_roundId);

    return (pid, aggregatorRoundId);
  }

  function phaseAggregators(uint16 /* _phaseId */) external view returns (address) {
    return address(aggregator);
  }
}
