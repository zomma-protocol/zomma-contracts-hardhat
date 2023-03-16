//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "../tokenomics/StakingPool.sol";

contract TestStakingPool is StakingPool {
  uint public timestamp;

  constructor(address _rewardPool, address _rewardToken, address _stakingToken) StakingPool(_rewardPool, _rewardToken, _stakingToken) {
  }

  function setTimestamp(uint _timestamp) external {
    timestamp = _timestamp;
  }

  function getTimestampPublic() external view returns (uint) {
    return getTimestamp();
  }

  function getTimestamp() internal view override returns (uint) {
    return timestamp == 0 ? block.timestamp : timestamp;
  }
}
