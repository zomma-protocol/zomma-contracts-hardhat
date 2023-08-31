//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "../tokenomics/TimeDistributedPool.sol";

contract TestTimeDistributedPool is TimeDistributedPool {
  uint public timestamp;

  constructor(
    string memory _name, string memory _symbol, uint8 _decimals, address _rewardsProvider, address _stakingToken
  ) TimeDistributedPool(
    _name, _symbol, _decimals, _rewardsProvider, _stakingToken
    ) {
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
