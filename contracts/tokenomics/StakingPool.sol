//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../utils/Timestamp.sol";
import "hardhat/console.sol";

abstract contract StakingPool is ERC20, Ownable, Timestamp {
  using SafeERC20 for IERC20;

  uint constant internal OFFSET = 2 ** 64;
  // uint constant internal OFFSET = 10 ** 18;

  mapping(address => mapping(address => uint)) public payout;
  mapping(address => uint) public unstakedAt;
  mapping(address => uint) public unstaking;
  mapping(address => bool) public rewardItemAdded;
  mapping(address => uint) public rewardPerShare;
  address[] public rewardItems;
  uint public unstakeLockTime = 7 days;
  address public rewardsProvider;
  address public stakingToken;
  uint8 internal decimals_;

  event ClaimUnstake(address indexed user, uint amount);
  event ClaimRewards(address indexed user, address rewardItem, uint amount);

  constructor(string memory _name, string memory _symbol, uint8 _decimals, address _rewardsProvider, address _stakingToken) ERC20(_name, _symbol) {
    rewardsProvider = _rewardsProvider;
    stakingToken = address(_stakingToken);
    decimals_ = _decimals;
  }

  function addRewardItem(address rewardItem) external onlyOwner {
    require(!rewardItemAdded[rewardItem], "rewardItem already exists");
    rewardItems.push(rewardItem);
    rewardItemAdded[rewardItem] = true;
  }

  function removeRewardItem(address rewardItem) external onlyOwner {
    require(rewardItemAdded[rewardItem], "rewardItem not found");
    distribute(rewardItem);
    uint length = rewardItems.length;
    bool found = false;
    for (uint i = 0; i < length; i++) {
      if (found) {
        rewardItems[i - 1] = rewardItems[i];
      } else if (rewardItems[i] == rewardItem) {
        found = true;
      }
    }
    rewardItems.pop();
    rewardItemAdded[rewardItem] = false;
  }

  function setUnstakeLockTime(uint _unstakeLockTime) external onlyOwner() {
    unstakeLockTime = _unstakeLockTime;
  }

  function rewardsOf(address rewardItem, address user) public view returns (uint) {
    return (rewardPerShareWithPending(rewardItem) * balanceOf(user) - payout[rewardItem][user]) / OFFSET;
  }

  function stake(uint amount) external {
    internalStake(msg.sender, amount, false);
  }

  function unstake(uint amount) external {
    require(balanceOf(msg.sender) >= amount, "balanceOf not enough");
    for (uint i = 0; i < rewardItems.length; ++i) {
      address rewardItem = rewardItems[i];
      internalClaimRewards(rewardItem, payable(msg.sender));
      payout[rewardItem][msg.sender] -= amount * rewardPerShareWithPending(rewardItem);
    }
    unstakedAt[msg.sender] = getTimestamp();
    unstaking[msg.sender] += amount;
    _burn(msg.sender, amount);
  }

  function claimUnstake() external {
    require(getTimestamp() - unstakedAt[msg.sender] > unstakeLockTime, 'locked');
    uint amount = unstaking[msg.sender];
    require(amount > 0, 'amount is 0');
    unstaking[msg.sender] = 0;
    emit ClaimUnstake(msg.sender, amount);
    IERC20(stakingToken).safeTransfer(msg.sender, amount);
  }

  function cancelUnstake() external {
    internalStake(msg.sender, unstaking[msg.sender], true);
  }

  function claimRewards(address rewardItem) external {
    internalClaimRewards(rewardItem, payable(msg.sender));
  }

  function claimAllRewards() external {
    internalClaimAllRewards(payable(msg.sender));
  }

  function _transfer(address from, address to, uint256 amount) internal override {
    revert('can not transfer');
  }

  function decimals() public view override returns (uint8) {
    return decimals_;
  }

  function pendingDistribution(address rewardItem) internal view virtual returns (uint);

  function rewardPerShareWithPending(address rewardItem) internal view returns (uint) {
    return rewardPerShare[rewardItem] + (totalSupply() == 0 ? 0 : (pendingDistribution(rewardItem) * OFFSET / totalSupply()));
  }

  function distribute(address rewardItem) internal {
    uint distribution = pendingDistribution(rewardItem);
    if (distribution > 0 && totalSupply() != 0) {
      rewardPerShare[rewardItem] += distribution * OFFSET / totalSupply();
      afterDistribute(rewardItem, distribution);
    }
  }

  function afterDistribute(address rewardItem, uint distribution) internal virtual;

  function internalStake(address beneficiary, uint amount, bool isCancelUnstake) internal virtual {
    require(amount > 0, 'amount is 0');
    if (isCancelUnstake) {
      unstaking[msg.sender] = 0;
    } else {
      IERC20(stakingToken).safeTransferFrom(msg.sender, address(this), amount);
    }
    for (uint i = 0; i < rewardItems.length; ++i) {
      address rewardItem = rewardItems[i];
      distribute(rewardItem);
      payout[rewardItem][beneficiary] += amount * rewardPerShareWithPending(rewardItem);
    }
    _mint(beneficiary, amount);
  }

  function internalClaimAllRewards(address payable user) internal {
    for (uint i = 0; i < rewardItems.length; ++i) {
      internalClaimRewards(rewardItems[i], user);
    }
  }

  function internalClaimRewards(address rewardItem, address payable user) internal {
    distribute(rewardItem);
    uint rewards = rewardsOf(rewardItem, user);
    if (rewards > 0) {
      // payout[rewardItem][user] += rewards * OFFSET;
      payout[rewardItem][user] += rewardPerShareWithPending(rewardItem) * balanceOf(user) - payout[rewardItem][user];
      sendRewards(rewardItem, user, rewards);
      emit ClaimRewards(user, rewardItem, rewards);
    }
  }

  function sendRewards(address rewardItem, address payable user, uint amount) internal virtual {
    IERC20(rewardItem).safeTransferFrom(rewardsProvider, user, amount);
  }
}
