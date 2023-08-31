//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "./StakingPool.sol";

contract TimeDistributedPool is StakingPool {
  mapping(address => uint) public distributionPerDay;
  mapping(address => uint) public lastDistributedAt;

  constructor(
    string memory _name, string memory _symbol, uint8 _decimals, address _rewardsProvider, address _stakingToken
  ) StakingPool(
    _name, _symbol, _decimals, _rewardsProvider, _stakingToken
  ) {
  }

  function setDistributionPerDay(address rewardItem, uint _distributionPerDay) external onlyOwner() {
    distribute(rewardItem);
    distributionPerDay[rewardItem] = _distributionPerDay;
  }

  function pendingDistribution(address rewardItem) internal view virtual override returns (uint) {
    return (getTimestamp() - lastDistributedAt[rewardItem]) * distributionPerDay[rewardItem] / 1 days;
  }

  function afterDistribute(address rewardItem, uint distribution) internal virtual override {
    lastDistributedAt[rewardItem] = getTimestamp();
  }

  function internalStake(address beneficiary, uint amount, bool isCancelUnstake) internal virtual override {
    if (totalSupply() == 0) {
      uint length = rewardItems.length;
      for (uint i; i < length;) {
        lastDistributedAt[rewardItems[i]] = getTimestamp();
        unchecked { ++i; }
      }
    }
    super.internalStake(beneficiary, amount, isCancelUnstake);
  }
}
