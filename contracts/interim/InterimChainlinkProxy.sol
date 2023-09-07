//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./InterimChainlink.sol";

contract InterimChainlinkProxy is Ownable {
  uint256 private constant PHASE_OFFSET = 64;

  uint16 public phaseId = 1;
  InterimChainlink public aggregator;

  function setChainlink(address _aggregator) external payable onlyOwner {
    aggregator = InterimChainlink(_aggregator);
  }

  function setPhaseId(uint16 _phaseId) external payable onlyOwner {
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
