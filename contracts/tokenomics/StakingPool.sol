//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../utils/Timestamp.sol";

contract StakingPool is Ownable, Timestamp {
  using SafeERC20 for IERC20;

  uint constant internal OFFSET = 2 ** 64;

  mapping (address => uint) public stakesOf;
  mapping (address => uint) public payout;

  address public rewardPool;
  address public rewardToken;
  address public stakingToken;
  uint public rewardPerShare;
  uint public totalStakes;
  uint public distributionPerDay;
  uint public lastDistributedAt;

  event Stake(address indexed user, uint amount);
  event Unstake(address indexed user, uint amount);
  event Claim(address indexed user, uint amount);

  constructor(address _rewardPool, address _rewardToken, address _stakingToken) {
    rewardPool = _rewardPool;
    rewardToken = _rewardToken;
    stakingToken = _stakingToken;
  }

  function setDistributionPerDay(uint _distributionPerDay) external onlyOwner() {
    distribute();
    distributionPerDay = _distributionPerDay;
  }

  function pendingDistribution() public view returns (uint) {
    return (getTimestamp() - lastDistributedAt) * distributionPerDay / 1 days;
  }

  function rewardPerShareWithPending() internal view returns (uint) {
    return rewardPerShare + (totalStakes == 0 ? 0 : (pendingDistribution() * OFFSET / totalStakes));
  }

  function distribute() internal {
    uint distribution = pendingDistribution();
    if (distribution > 0 && totalStakes != 0) {
      rewardPerShare += distribution * OFFSET / totalStakes;
      lastDistributedAt = getTimestamp();
    }
  }

  function stake(uint amount) external {
    if (totalStakes == 0) {
      lastDistributedAt = getTimestamp();
    }
    distribute();
    IERC20(stakingToken).safeTransferFrom(msg.sender, address(this), amount);
    stakesOf[msg.sender] += amount;
    payout[msg.sender] += amount * rewardPerShareWithPending();
    totalStakes += amount;
    emit Stake(msg.sender, amount);
  }

  function unstake(uint amount) external {
    require(stakesOf[msg.sender] >= amount, "stakesOf not enough");
    internalClaim(payable(msg.sender));
    payout[msg.sender] -= amount * rewardPerShareWithPending();
    stakesOf[msg.sender] -= amount;
    totalStakes -= amount;
    emit Unstake(msg.sender, amount);
    IERC20(stakingToken).safeTransfer(msg.sender, amount);
  }

  function claim() public {
    internalClaim(payable(msg.sender));
  }

  function internalClaim(address payable user) internal {
    distribute();
    uint reward = rewardOf(user);
    if (reward > 0) {
      payout[user] += reward * OFFSET;
      IERC20(rewardToken).safeTransferFrom(rewardPool, user, reward);
      emit Claim(user, reward);
    }
  }

  function rewardOf(address user) public view returns (uint) {
    return (rewardPerShareWithPending() * stakesOf[user] - payout[user]) / OFFSET;
  }
}
