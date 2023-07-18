//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "../Vault.sol";
import "../OptionMarket.sol";
import "../Config.sol";
import "./PoolToken.sol";

contract Pool is Ownable {
  using SafeDecimalMath for uint;
  using SafeERC20 for IERC20;

  enum ChangeType {
    zlmRate,
    bonusRate,
    withdrawFeeRate,
    freeWithdrawableRate
  }

  IERC20 public quoteAsset;
  Vault public vault;
  PoolToken public token;
  Config public config;
  uint public quoteDecimal;
  uint public zlmRate;
  uint public bonusRate;
  uint public withdrawFeeRate;
  uint public freeWithdrawableRate;
  bool public initialized;

  uint private constant MAX_ZLM_RATE = 1000000000000000000; // 1
  uint private constant MAX_BONUS_RATE = 1000000000000000000; // 100%
  uint private constant MAX_WITHDRAW_FEE_RATE = 100000000000000000; // 10%
  uint private constant MAX_FREE_WITHDRAWABLE_RATE = 1000000000000000000; // 100%

  event ConfigChange(ChangeType changeType, bytes value);
  event Deposit(address account, uint amount, uint shares);
  event Withdraw(address account, uint amount, uint shares, uint fee);

  function initialize(address _vault, address _token, address owner_) external {
    require(!initialized, "already initialized");
    initialized = true;
    _transferOwnership(owner_);
    zlmRate = 800000000000000000; // 0.8
    bonusRate = 60000000000000000; // 6%
    withdrawFeeRate = 1000000000000000; // 0.1%
    freeWithdrawableRate = 400000000000000000; // 40%
    vault = Vault(_vault);
    token = PoolToken(_token);
    config = Config(vault.config());
    quoteDecimal = config.quoteDecimal();
    quoteAsset = IERC20(config.quote());
    quoteAsset.safeApprove(_vault, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
    config.enablePool();
  }

  function setReservedRate(uint reservedRate) external onlyOwner {
    config.setPoolReservedRate(reservedRate);
  }

  function setZlmRate(uint _zlmRate) external onlyOwner {
    require(_zlmRate <= MAX_ZLM_RATE, "exceed the limit");
    zlmRate = _zlmRate;
    emit ConfigChange(ChangeType.zlmRate, abi.encodePacked(_zlmRate));
  }

  function setBonusRate(uint _bonusRate) external onlyOwner {
    require(_bonusRate <= MAX_BONUS_RATE, "exceed the limit");
    bonusRate = _bonusRate;
    emit ConfigChange(ChangeType.bonusRate, abi.encodePacked(_bonusRate));
  }

  function setWithdrawFeeRate(uint _withdrawFeeRate) external onlyOwner {
    require(_withdrawFeeRate <= MAX_WITHDRAW_FEE_RATE, "exceed the limit");
    withdrawFeeRate = _withdrawFeeRate;
    emit ConfigChange(ChangeType.withdrawFeeRate, abi.encodePacked(_withdrawFeeRate));
  }

  function setFreeWithdrawableRate(uint _freeWithdrawableRate) external onlyOwner {
    require(_freeWithdrawableRate <= MAX_FREE_WITHDRAWABLE_RATE, "exceed the limit");
    freeWithdrawableRate = _freeWithdrawableRate;
    emit ConfigChange(ChangeType.freeWithdrawableRate, abi.encodePacked(_freeWithdrawableRate));
  }

  function deposit(uint256 amount) external {
    amount = amount.truncate(quoteDecimal);
    require(amount > 0, 'amount is 0');
    transferFrom(msg.sender, address(this), amount);
    // Vault.AccountInfo memory accountInfo = vault.getAccountInfo(address(this));
    IVault.AccountInfo memory accountInfo = getAccountInfo(address(this));
    uint256 totalSupply = token.totalSupply();
    uint256 shares;
    if (totalSupply == 0) {
      shares = amount;
    } else {
      require(accountInfo.equity > 0, "pool bankruptcy");
      uint adjustedAmount = amount;
      // zlm
      if (accountInfo.healthFactor < int(zlmRate)) {
        uint bonusPart = uint(int(accountInfo.initialMargin) - accountInfo.marginBalance);
        if (amount < bonusPart) {
          bonusPart = amount;
        }
        adjustedAmount = (amount - bonusPart) + bonusPart.decimalMul(SafeDecimalMath.UNIT + bonusRate);
      }
      shares = adjustedAmount * totalSupply / uint(accountInfo.equity);
      require(shares > 0, 'shares is 0');
    }

    token.mint(msg.sender, shares);
    // vault.deposit(amount);
    internalDeposit(amount);

    emit Deposit(msg.sender, amount, shares);
  }

  function withdraw(uint256 shares, uint acceptableAmount) external {
    uint256 totalSupply = token.totalSupply();
    uint rate = shares.decimalDiv(totalSupply);
    uint afterFeeRate = rate == SafeDecimalMath.UNIT ? rate : rate.decimalMul(SafeDecimalMath.UNIT - withdrawFeeRate);
    token.burn(msg.sender, shares);
    // uint amount = vault.withdrawPercent(afterFeeRate, acceptableAmount, freeWithdrawableRate);
    uint amount = withdrawPercent(afterFeeRate, acceptableAmount, freeWithdrawableRate);
    transfer(msg.sender, amount);
    uint fee = rate == SafeDecimalMath.UNIT ? 0 : amount.decimalDiv(SafeDecimalMath.UNIT - withdrawFeeRate).decimalMul(withdrawFeeRate);
    emit Withdraw(msg.sender, amount, shares, fee);
  }

  function transfer(address to, uint amount) private {
    quoteAsset.safeTransfer(to, (amount * 10**quoteDecimal) / SafeDecimalMath.UNIT);
  }

  function transferFrom(address from, address to, uint amount) private {
    quoteAsset.safeTransferFrom(from, to, (amount * 10**quoteDecimal) / SafeDecimalMath.UNIT);
  }

  function getAccountInfo(address addr) internal view virtual returns (IVault.AccountInfo memory) {
    return vault.getAccountInfo(addr);
  }

  function internalDeposit(uint amount) internal virtual {
    vault.deposit(amount);
  }

  function withdrawPercent(uint rate, uint acceptableAmount, uint _freeWithdrawableRate) internal virtual returns (uint) {
    return vault.withdrawPercent(rate, acceptableAmount, _freeWithdrawableRate);
  }
}
