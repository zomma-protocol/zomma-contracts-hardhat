//SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.20;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "./libraries/SafeDecimalMath.sol";
import "./Vault.sol";

contract Config is OwnableUpgradeable {
  enum ChangeType {
    initialMarginRiskRate,
    liquidateRate,
    clearRate,
    liquidationReward,
    minLiquidation,
    riskFreeRate,
    priceRatio,
    priceRatio2,
    priceRatioUtilization,
    spotFee,
    optionFee,
    minPremium,
    exerciseFeeRate,
    profitFeeRate,
    poolProportion,
    insuranceProportion,
    insuranceAccount,
    stakeholderAccount
  }

  uint private constant MAX_INITIAL_MARGIN_RISK_RATE = 1000000000000000000; // 100%
  uint private constant MAX_LIQUIDATE_RATE = 1000000000000000000; // 1
  uint private constant MAX_CLEAR_RATE = 1000000000000000000; // 1
  uint private constant MAX_LIQUIDATION_REWARD = 1000000000000000000; // 100%
  uint private constant MAX_PRICE_RATIO_UTILIZATION = 1000000000000000000; // 100%
  uint private constant MAX_SPOT_FEE = 100000000000000000; // 10%
  uint private constant MAX_OPTION_FEE = 200000000000000000; // 20%
  uint private constant MAX_EXERCISE_FEE_RATE = 100000000000000000; // 10%
  uint private constant MAX_PROFIT_FEE_RATE = 500000000000000000; // 50%
  uint private constant MAX_RESERVED_RATE = 1000000000000000000; // 100%
  uint private constant MAX_POOL_PROPORTION = 1000000000000000000; // 100%
  uint private constant MAX_INSURANCE_PROPORTION = 1000000000000000000; // 100%

  address[] public pools;
  mapping(address => bool) public poolAdded;
  // willingness to be a pool
  mapping(address => bool) public poolEnabled;
  mapping(address => uint) public poolReservedRate;
  uint public quoteDecimal;
  uint public initialMarginRiskRate;
  uint public liquidateRate;
  uint public clearRate;
  uint public liquidationReward;
  uint public minLiquidation;
  int public riskFreeRate;
  uint public priceRatio;
  uint public priceRatio2;
  uint public priceRatioUtilization;
  uint public spotFee;
  uint public optionFee;
  uint public minPremium;
  uint public exerciseFeeRate;
  uint public profitFeeRate;
  uint public poolProportion;
  uint public insuranceProportion;
  Vault public vault;
  address public quote;
  address public insuranceAccount;
  address public stakeholderAccount;
  // 1: paused, other: not paused
  mapping(address => uint) public poolPaused;

  event Change(ChangeType changeType, bytes value);
  event AddPool(address pool);
  event RemovePool(address pool);
  event SetPoolReservedRate(address pool, uint reservedRate);
  event SetPoolPaused(address pool, uint status);

  error ZeroAddress();
  error OutOfRange();
  error InvalidRatio();
  error PoolNotEnabled();
  error PositionNotEmpty();
  error TooManyPools();
  error DuplicatedPool();
  error PoolNotFound();

  function initialize(address _vault, address _stakeholderAccount, address _insuranceAccount, address _quote, uint _quoteDecimal) external initializer {
    __Ownable_init();
    vault = Vault(_vault);
    quote = _quote;
    quoteDecimal = _quoteDecimal;
    stakeholderAccount = _stakeholderAccount;
    insuranceAccount = _insuranceAccount;
    initialMarginRiskRate = 100000000000000000; // 10 %
    liquidateRate = 500000000000000000; // 0.5
    clearRate = 200000000000000000; // 0.2
    liquidationReward = 100000000000000000; // 10 %
    minLiquidation = 100000000000000000000; // 100 (usd)
    riskFreeRate = 60000000000000000; // 6 %
    priceRatio = 100000000000000000; // 10%
    priceRatio2 = 1000000000000000000; // 100%
    priceRatioUtilization = 950000000000000000; // 95%
    spotFee = 300000000000000; // 0.03 %
    optionFee = 10000000000000000; // 1 %
    minPremium = 1000000000000000000; // 1 (usd)
    exerciseFeeRate = 150000000000000; // 0.015 %
    profitFeeRate = 100000000000000000; // 10 %
    poolProportion = 700000000000000000; // 70%
    insuranceProportion = 300000000000000000; // 30%
  }

  function setInitialMarginRiskRate(uint _initialMarginRiskRate) external payable onlyOwner {
    if (_initialMarginRiskRate > MAX_INITIAL_MARGIN_RISK_RATE) {
      revert OutOfRange();
    }
    initialMarginRiskRate = _initialMarginRiskRate;
    emit Change(ChangeType.initialMarginRiskRate, abi.encodePacked(_initialMarginRiskRate));
  }

  function setLiquidateRate(uint _liquidateRate) external payable onlyOwner {
    if (_liquidateRate > MAX_LIQUIDATE_RATE || clearRate > _liquidateRate) {
      revert OutOfRange();
    }
    liquidateRate = _liquidateRate;
    emit Change(ChangeType.liquidateRate, abi.encodePacked(_liquidateRate));
  }

  function setClearRate(uint _clearRate) external payable onlyOwner {
    if (_clearRate > MAX_CLEAR_RATE || _clearRate > liquidateRate) {
      revert OutOfRange();
    }
    clearRate = _clearRate;
    emit Change(ChangeType.clearRate, abi.encodePacked(_clearRate));
  }

  function setLiquidationReward(uint _liquidationReward) external payable onlyOwner {
    if (_liquidationReward > MAX_LIQUIDATION_REWARD) {
      revert OutOfRange();
    }
    liquidationReward = _liquidationReward;
    emit Change(ChangeType.liquidateRate, abi.encodePacked(_liquidationReward));
  }

  function setMinLiquidation(uint _minLiquidation) external payable onlyOwner {
    minLiquidation = _minLiquidation;
    emit Change(ChangeType.minLiquidation, abi.encodePacked(_minLiquidation));
  }

  function setRiskFreeRate(int _riskFreeRate) external payable onlyOwner {
    riskFreeRate = _riskFreeRate;
    emit Change(ChangeType.riskFreeRate, abi.encodePacked(_riskFreeRate));
  }

  function setPriceRatio(uint _priceRatio, uint _priceRatio2) external payable onlyOwner {
    if (_priceRatio > _priceRatio2) {
      revert InvalidRatio();
    }
    priceRatio = _priceRatio;
    priceRatio2 = _priceRatio2;
    emit Change(ChangeType.priceRatio, abi.encodePacked(_priceRatio));
    emit Change(ChangeType.priceRatio2, abi.encodePacked(_priceRatio2));
  }

  function setPriceRatioUtilization(uint _priceRatioUtilization) external payable onlyOwner {
    if (_priceRatioUtilization > MAX_PRICE_RATIO_UTILIZATION) {
      revert OutOfRange();
    }
    priceRatioUtilization = _priceRatioUtilization;
    emit Change(ChangeType.priceRatioUtilization, abi.encodePacked(_priceRatioUtilization));
  }

  function setSpotFee(uint _spotFee) external payable onlyOwner {
    if (_spotFee > MAX_SPOT_FEE) {
      revert OutOfRange();
    }
    spotFee = _spotFee;
    emit Change(ChangeType.spotFee, abi.encodePacked(_spotFee));
  }

  function setOptionFee(uint _optionFee) external payable onlyOwner {
    if (_optionFee > MAX_OPTION_FEE) {
      revert OutOfRange();
    }
    optionFee = _optionFee;
    emit Change(ChangeType.optionFee, abi.encodePacked(_optionFee));
  }

  function setMinPremium(uint _minPremium) external payable onlyOwner {
    minPremium = _minPremium;
    emit Change(ChangeType.minPremium, abi.encodePacked(_minPremium));
  }

  function setExerciseFeeRate(uint _exerciseFeeRate) external payable onlyOwner {
    if (_exerciseFeeRate > MAX_EXERCISE_FEE_RATE) {
      revert OutOfRange();
    }
    exerciseFeeRate = _exerciseFeeRate;
    emit Change(ChangeType.exerciseFeeRate, abi.encodePacked(_exerciseFeeRate));
  }

  function setProfitFeeRate(uint _profitFeeRate) external payable onlyOwner {
    if (_profitFeeRate > MAX_PROFIT_FEE_RATE) {
      revert OutOfRange();
    }
    profitFeeRate = _profitFeeRate;
    emit Change(ChangeType.profitFeeRate, abi.encodePacked(_profitFeeRate));
  }

  function setPoolProportion(uint _poolProportion) external payable onlyOwner {
    if (_poolProportion > MAX_POOL_PROPORTION) {
      revert OutOfRange();
    }
    poolProportion = _poolProportion;
    emit Change(ChangeType.poolProportion, abi.encodePacked(_poolProportion));
  }

  function setInsuranceProportion(uint _insuranceProportion) external payable onlyOwner {
    if (_insuranceProportion > MAX_INSURANCE_PROPORTION) {
      revert OutOfRange();
    }
    insuranceProportion = _insuranceProportion;
    emit Change(ChangeType.insuranceProportion, abi.encodePacked(_insuranceProportion));
  }

  function setInsuranceAccount(address _insuranceAccount) external payable onlyOwner {
    if (_insuranceAccount == address(0)) {
      revert ZeroAddress();
    }
    insuranceAccount = _insuranceAccount;
    emit Change(ChangeType.insuranceAccount, abi.encodePacked(_insuranceAccount));
  }

  function setStakeholderAccount(address _stakeholderAccount) external payable onlyOwner {
    if (_stakeholderAccount == address(0)) {
      revert ZeroAddress();
    }
    stakeholderAccount = _stakeholderAccount;
    emit Change(ChangeType.stakeholderAccount, abi.encodePacked(_stakeholderAccount));
  }

  function setPoolPaused(address pool, uint status) external payable onlyOwner {
    poolPaused[pool] = status;
    emit SetPoolPaused(pool, status);
  }

  /**
  * @dev Add an account as pool. Account should enable to be a pool first.
  */
  function addPool(address pool) external payable onlyOwner {
    if (!poolEnabled[pool]) {
      revert PoolNotEnabled();
    }
    if (vault.listOfExpiries(pool).length > 0) {
      revert PositionNotEmpty();
    }
    if (pools.length >= 10) {
      revert TooManyPools();
    }
    if (poolAdded[pool]) {
      revert DuplicatedPool();
    }
    pools.push(pool);
    poolAdded[pool] = true;
    emit AddPool(pool);
  }

  /**
  * @dev Remove an account from pools.
  */
  function removePool(address pool) external payable onlyOwner {
    if (vault.listOfExpiries(pool).length > 0) {
      revert PositionNotEmpty();
    }
    if (!poolAdded[pool]) {
      revert PoolNotFound();
    }
    uint length = pools.length;
    bool found;
    for (uint i; i < length;) {
      if (found) {
        unchecked { pools[i - 1] = pools[i]; }
      } else if (pools[i] == pool) {
        found = true;
      }
      unchecked { ++i; }
    }
    pools.pop();
    poolAdded[pool] = false;
    emit RemovePool(pool);
  }

  function enablePool() external {
    poolEnabled[msg.sender] = true;
  }

  function disablePool() external {
    poolEnabled[msg.sender] = false;
  }

  function setPoolReservedRate(uint reservedRate) external {
    if (reservedRate > MAX_RESERVED_RATE) {
      revert OutOfRange();
    }
    poolReservedRate[msg.sender] = reservedRate;
    emit SetPoolReservedRate(msg.sender, reservedRate);
  }

  function getPoolReservedRateForTrade(address pool) external view returns(uint, uint) {
    return (poolPaused[pool], poolReservedRate[pool]);
  }

  function getPools() external view returns(address[] memory) {
    return pools;
  }

  // function checkZeroAddress(address addr) internal pure {
  //   assembly {
  //     if iszero(addr) {
  //       let ptr := mload(0x40)
  //       mstore(ptr, 0xd92e233d00000000000000000000000000000000000000000000000000000000) // selector for `ZeroAddress()`
  //       revert(ptr, 0x4)
  //     }
  //   }
  // }
}
