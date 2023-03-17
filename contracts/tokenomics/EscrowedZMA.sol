//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "./TimeDistributedPool.sol";
import "./IRewardCollector.sol";

contract EscrowedZMA is TimeDistributedPool {
  using SafeERC20 for IERC20;

  mapping(address => bool) isRewardCollector;

  constructor(address _rewardsProvider, address _stakingToken, address _zma) TimeDistributedPool('Escrowed ZOMMA Token', 'esZMA', 18, _rewardsProvider, _stakingToken) {
  }

  function stakeFor(uint amount, address beneficiary) external {
    internalStake(beneficiary, amount, false);
  }

  function setRewardCollector(address addr, bool value) external onlyOwner() {
    isRewardCollector[addr] = value;
  }

  function pendingDistribution(address rewardItem) internal view virtual override returns (uint) {
    if (isRewardCollector[rewardItem]) {
      return IRewardCollector(rewardItem).rewards();
    } else {
      return super.pendingDistribution(rewardItem);
    }
  }

  function afterDistribute(address rewardItem, uint distribution) internal virtual override {
    if (isRewardCollector[rewardItem]) {
      IRewardCollector(rewardItem).claim(distribution);
    } else {
      super.afterDistribute(rewardItem, distribution);
    }
  }

  function sendRewards(address rewardItem, address payable user, uint amount) internal virtual override {
    if (isRewardCollector[rewardItem]) {
      IERC20(IRewardCollector(rewardItem).token()).safeTransfer(user, amount);
    } else {
      super.sendRewards(rewardItem, user, amount);
    }
  }
}
