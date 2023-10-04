//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "../utils/Timestamp.sol";
import "../Vault.sol";
import "../OptionMarket.sol";
import "../Config.sol";
import "../SignatureValidator.sol";
import "./PoolToken.sol";

/**
 * @dev Pool contract is for makers to deposit.
 */
contract Pool is OwnableUpgradeable, Timestamp {
  using SafeDecimalMath for uint;
  using SafeERC20 for IERC20;

  enum ChangeType {
    zlmRate,
    bonusRate,
    withdrawFeeRate,
    freeWithdrawableRate
  }

  uint private constant ONE = 1 ether;
  uint private constant MAX_ZLM_RATE = 1000000000000000000; // 1
  uint private constant MAX_BONUS_RATE = 1000000000000000000; // 100%
  uint private constant MAX_WITHDRAW_FEE_RATE = 100000000000000000; // 10%
  uint private constant MAX_FREE_WITHDRAWABLE_RATE = 1000000000000000000; // 100%
  uint private constant MINIMUM_LIQUIDITY = 10**3;
  address private constant DEAD_ADDRESS = 0x000000000000000000000000000000000000dEaD;

  // keccak256("Withdraw(uint256 shares,uint256 acceptableAmount,uint256 deadline,uint256 gasFee,uint256 nonce)")
  bytes32 private constant WITHDRAW_TYPEHASH = 0x6682ff92be6125d0901e00bd816fac22de7a8851a4b6b028961990f61878c873;

  IERC20 public quoteAsset;
  Vault public vault;
  PoolToken public token;
  Config public config;
  SignatureValidator public signatureValidator;
  uint public quoteDecimal;
  uint public zlmRate;
  uint public bonusRate;
  uint public withdrawFeeRate;
  uint public freeWithdrawableRate;

  event ConfigChange(ChangeType changeType, bytes value);
  event Deposit(address account, uint amount, uint shares);
  event Withdraw(address account, uint amount, uint shares, uint fee, uint gasFee);

  error OutOfRange();
  error ZeroAmount();
  error ZeroShare();
  error Bankruptcy();
  error Expired();

  /**
  * @dev Initalize method. Can call only once.
  * @param _vault: Should be Vault address.
  * @param _token: Should be quote token address. (eg. USDC)
  */
  function initialize(address _vault, address _token) external initializer {
    __Ownable_init();
    zlmRate = 800000000000000000; // 0.8
    bonusRate = 60000000000000000; // 6%
    withdrawFeeRate = 1000000000000000; // 0.1%
    freeWithdrawableRate = 400000000000000000; // 40%
    vault = Vault(_vault);
    token = PoolToken(_token);
    config = Config(vault.config());
    signatureValidator = SignatureValidator(vault.signatureValidator());
    quoteDecimal = config.quoteDecimal();
    quoteAsset = IERC20(config.quote());
    quoteAsset.safeIncreaseAllowance(_vault, 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff);
    config.enablePool();
  }

  function setReservedRate(uint reservedRate) external payable onlyOwner {
    config.setPoolReservedRate(reservedRate);
  }

  function setZlmRate(uint _zlmRate) external payable onlyOwner {
    if (_zlmRate > MAX_ZLM_RATE) {
      revert OutOfRange();
    }
    zlmRate = _zlmRate;
    emit ConfigChange(ChangeType.zlmRate, abi.encodePacked(_zlmRate));
  }

  function setBonusRate(uint _bonusRate) external payable onlyOwner {
    if (_bonusRate > MAX_BONUS_RATE) {
      revert OutOfRange();
    }
    bonusRate = _bonusRate;
    emit ConfigChange(ChangeType.bonusRate, abi.encodePacked(_bonusRate));
  }

  function setWithdrawFeeRate(uint _withdrawFeeRate) external payable onlyOwner {
    if (_withdrawFeeRate > MAX_WITHDRAW_FEE_RATE) {
      revert OutOfRange();
    }
    withdrawFeeRate = _withdrawFeeRate;
    emit ConfigChange(ChangeType.withdrawFeeRate, abi.encodePacked(_withdrawFeeRate));
  }

  function setFreeWithdrawableRate(uint _freeWithdrawableRate) external payable onlyOwner {
    if (_freeWithdrawableRate > MAX_FREE_WITHDRAWABLE_RATE) {
      revert OutOfRange();
    }
    freeWithdrawableRate = _freeWithdrawableRate;
    emit ConfigChange(ChangeType.freeWithdrawableRate, abi.encodePacked(_freeWithdrawableRate));
  }

  /**
  * @dev Deposit and get shares. Will get bonus when hf < 0.8.
  * @param amount: Amount to deposit. In decimals 18.
  */
  function deposit(uint amount) external {
    amount = amount.truncate(quoteDecimal);
    if (amount == 0) {
      revert ZeroAmount();
    }
    transferFrom(msg.sender, address(this), amount);
    IVault.AccountInfo memory accountInfo = getAccountInfo(address(this));
    uint totalSupply = token.totalSupply();
    uint shares;
    if (totalSupply == 0) {
      shares = amount - MINIMUM_LIQUIDITY;
      token.mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);
    } else {
      if (accountInfo.equity <= 0) {
        revert Bankruptcy();
      }
      uint adjustedAmount = amount;
      // zlm
      if (accountInfo.healthFactor < int(zlmRate)) {
        // only lack of margin part (hf < 1) can get bonus
        uint bonusPart = uint(int(accountInfo.initialMargin) - accountInfo.marginBalance);
        if (amount < bonusPart) {
          bonusPart = amount;
        }
        adjustedAmount = (amount - bonusPart) + bonusPart.decimalMul(ONE + bonusRate);
      }
      shares = adjustedAmount * totalSupply / uint(accountInfo.equity);
    }
    if (shares == 0) {
      revert ZeroShare();
    }

    token.mint(msg.sender, shares);
    internalDeposit(amount);

    emit Deposit(msg.sender, amount, shares);
  }

  function withdrawBySignature(uint shares, uint acceptableAmount, uint deadline, uint gasFee, uint nonce, uint8 v, bytes32 r, bytes32 s) external {
    if (int(gasFee) < 0) {
      revert OutOfRange();
    }
    bytes memory aheadEncodedData = abi.encode(WITHDRAW_TYPEHASH, shares, acceptableAmount, deadline, gasFee);
    address signer = signatureValidator.recoverAndUseNonce(aheadEncodedData, nonce, v, r, s);
    internalWithdraw(shares, acceptableAmount, deadline, gasFee, signer, msg.sender);
  }

  /**
  * @dev Burn shares and withdraw. It will be charged a withdrawal fee. (Default is 0.1%)
  * @param shares: Share to burn for withdrawal. In decimals 18.
  * @param acceptableAmount: Acceptable amount after slippage. In decimals 18.
  */
  function withdraw(uint shares, uint acceptableAmount, uint deadline) external {
    internalWithdraw(shares, acceptableAmount, deadline, 0, msg.sender, msg.sender);
  }

  function internalWithdraw(uint shares, uint acceptableAmount, uint deadline, uint gasFee, address account, address gasReceiver) internal virtual {
    if (getTimestamp() > deadline) {
      revert Expired();
    }
    uint totalSupply = token.totalSupply();
    uint deadShares = token.balanceOf(DEAD_ADDRESS);
    uint rate;
    token.burn(account, shares);
    if (shares + deadShares == totalSupply) {
      token.burn(DEAD_ADDRESS, deadShares);
      rate = ONE;
    } else {
      rate = shares.decimalDiv(totalSupply);
    }
    uint afterFeeRate = rate == ONE ? rate : rate.decimalMul(ONE - withdrawFeeRate);
    uint amount = withdrawPercent(afterFeeRate, acceptableAmount, freeWithdrawableRate);
    uint amountAfterGas = amount;
    gasFee = gasFee.truncate(quoteDecimal);
    if (gasFee > 0) {
      amountAfterGas = amount - gasFee;
      transfer(gasReceiver, gasFee);
    }
    transfer(account, amountAfterGas);
    uint fee = rate == ONE ? 0 : amount.decimalDiv(ONE - withdrawFeeRate).decimalMul(withdrawFeeRate);
    emit Withdraw(account, amount, shares, fee, gasFee);
  }

  function transfer(address to, uint amount) private {
    quoteAsset.safeTransfer(to, (amount * 10**quoteDecimal) / ONE);
  }

  function transferFrom(address from, address to, uint amount) private {
    quoteAsset.safeTransferFrom(from, to, (amount * 10**quoteDecimal) / ONE);
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

  uint[40] private __gap;
}
