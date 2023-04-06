//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/access/Ownable.sol";
import "./InterimChainlink.sol";

contract InterimChainlinkProxy is Ownable {
  uint16 public phaseId = 1;
  InterimChainlink public aggregator;

  uint256 constant private PHASE_OFFSET = 64;

  function setChainlink(address _aggregator) external onlyOwner {
    aggregator = InterimChainlink(_aggregator);
  }

  function setPhaseId(uint16 _phaseId) external onlyOwner {
    phaseId = _phaseId;
  }

  function decimals() external view returns (uint8) {
    return aggregator.decimals();
  }

  function latestAnswer() external view returns (int256) {
    return aggregator.latestAnswer();
  }

  function getAnswer(uint _roundId) external view returns (int256) {
    (uint16 pid, uint64 aggregatorRoundId) = parseIds(_roundId);
    return aggregator.getAnswer(aggregatorRoundId);
  }

  function getTimestamp(uint _roundId) external view returns (uint256) {
    (uint16 pid, uint64 aggregatorRoundId) = parseIds(_roundId);
    return aggregator.getTimestamp(aggregatorRoundId);
  }

  function parseIds(uint256 _roundId) internal view returns (uint16, uint64) {
    uint16 pid = uint16(_roundId >> PHASE_OFFSET);
    uint64 aggregatorRoundId = uint64(_roundId);

    return (pid, aggregatorRoundId);
  }

  function phaseAggregators(uint16 _phaseId) external view returns (address) {
    return address(aggregator);
  }
}
