//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "./StakableToken.sol";

contract TimeDistributedPool is StakableToken {
  mapping(address => uint) public distributionPerDay;
  mapping(address => uint) public lastDistributedAt;

  constructor(
    string memory _name, string memory _symbol, uint8 _decimals, address _rewardsProvider, address _stakingToken
  ) StakableToken(
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
      for (uint i = 0; i < rewardItems.length; ++i) {
        lastDistributedAt[rewardItems[i]] = getTimestamp();
      }
    }
    super.internalStake(beneficiary, amount, isCancelUnstake);
  }
}
