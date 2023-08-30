//SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.11;

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

  address[] public pools;
  mapping(address => bool) public poolAdded;
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

  event Change(ChangeType changeType, bytes value);
  event AddPool(address pool);
  event RemovePool(address pool);
  event SetPoolReservedRate(address pool, uint reservedRate);

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

  function setInitialMarginRiskRate(uint _initialMarginRiskRate) external onlyOwner {
    require(_initialMarginRiskRate <= MAX_INITIAL_MARGIN_RISK_RATE, "exceed the limit");
    initialMarginRiskRate = _initialMarginRiskRate;
    emit Change(ChangeType.initialMarginRiskRate, abi.encodePacked(_initialMarginRiskRate));
  }

  function setLiquidateRate(uint _liquidateRate) external onlyOwner {
    require(_liquidateRate <= MAX_LIQUIDATE_RATE && clearRate <= _liquidateRate, "exceed the limit");
    liquidateRate = _liquidateRate;
    emit Change(ChangeType.liquidateRate, abi.encodePacked(_liquidateRate));
  }

  function setClearRate(uint _clearRate) external onlyOwner {
    require(_clearRate <= MAX_CLEAR_RATE && _clearRate <= liquidateRate, "exceed the limit");
    clearRate = _clearRate;
    emit Change(ChangeType.clearRate, abi.encodePacked(_clearRate));
  }

  function setLiquidationReward(uint _liquidationReward) external onlyOwner {
    require(_liquidationReward <= MAX_LIQUIDATION_REWARD, "exceed the limit");
    liquidationReward = _liquidationReward;
    emit Change(ChangeType.liquidateRate, abi.encodePacked(_liquidationReward));
  }

  function setMinLiquidation(uint _minLiquidation) external onlyOwner {
    minLiquidation = _minLiquidation;
    emit Change(ChangeType.minLiquidation, abi.encodePacked(_minLiquidation));
  }

  function setRiskFreeRate(int _riskFreeRate) external onlyOwner {
    riskFreeRate = _riskFreeRate;
    emit Change(ChangeType.riskFreeRate, abi.encodePacked(_riskFreeRate));
  }

  function setPriceRatio(uint _priceRatio, uint _priceRatio2) external onlyOwner {
    require(_priceRatio <= _priceRatio2, "invalid price ratio");
    priceRatio = _priceRatio;
    priceRatio2 = _priceRatio2;
    emit Change(ChangeType.priceRatio, abi.encodePacked(_priceRatio));
    emit Change(ChangeType.priceRatio2, abi.encodePacked(_priceRatio2));
  }

  function setPriceRatioUtilization(uint _priceRatioUtilization) external onlyOwner {
    require(_priceRatioUtilization <= MAX_PRICE_RATIO_UTILIZATION, "exceed the limit");
    priceRatioUtilization = _priceRatioUtilization;
    emit Change(ChangeType.priceRatioUtilization, abi.encodePacked(_priceRatioUtilization));
  }

  function setSpotFee(uint _spotFee) external onlyOwner {
    require(_spotFee <= MAX_SPOT_FEE, "exceed the limit");
    spotFee = _spotFee;
    emit Change(ChangeType.spotFee, abi.encodePacked(_spotFee));
  }

  function setOptionFee(uint _optionFee) external onlyOwner {
    require(_optionFee <= MAX_OPTION_FEE, "exceed the limit");
    optionFee = _optionFee;
    emit Change(ChangeType.optionFee, abi.encodePacked(_optionFee));
  }

  function setMinPremium(uint _minPremium) external onlyOwner {
    minPremium = _minPremium;
    emit Change(ChangeType.minPremium, abi.encodePacked(_minPremium));
  }

  function setExerciseFeeRate(uint _exerciseFeeRate) external onlyOwner {
    require(_exerciseFeeRate <= MAX_EXERCISE_FEE_RATE, "exceed the limit");
    exerciseFeeRate = _exerciseFeeRate;
    emit Change(ChangeType.exerciseFeeRate, abi.encodePacked(_exerciseFeeRate));
  }

  function setProfitFeeRate(uint _profitFeeRate) external onlyOwner {
    require(_profitFeeRate <= MAX_PROFIT_FEE_RATE, "exceed the limit");
    profitFeeRate = _profitFeeRate;
    emit Change(ChangeType.profitFeeRate, abi.encodePacked(_profitFeeRate));
  }

  function setPoolProportion(uint _poolProportion) external onlyOwner {
    require(_poolProportion <= MAX_POOL_PROPORTION, "exceed the limit");
    poolProportion = _poolProportion;
    emit Change(ChangeType.poolProportion, abi.encodePacked(_poolProportion));
  }

  function setInsuranceProportion(uint _insuranceProportion) external onlyOwner {
    require(_insuranceProportion <= MAX_INSURANCE_PROPORTION, "exceed the limit");
    insuranceProportion = _insuranceProportion;
    emit Change(ChangeType.insuranceProportion, abi.encodePacked(_insuranceProportion));
  }

  function setInsuranceAccount(address _insuranceAccount) external onlyOwner {
    require(_insuranceAccount != address(0), "can't be zero address");
    insuranceAccount = _insuranceAccount;
    emit Change(ChangeType.insuranceAccount, abi.encodePacked(_insuranceAccount));
  }

  function setStakeholderAccount(address _stakeholderAccount) external onlyOwner {
    require(_stakeholderAccount != address(0), "can't be zero address");
    stakeholderAccount = _stakeholderAccount;
    emit Change(ChangeType.stakeholderAccount, abi.encodePacked(_stakeholderAccount));
  }

  /**
  * @dev Add an account as pool. Account should enable to be a pool first.
  */
  function addPool(address pool) external onlyOwner {
    require(poolEnabled[pool], "need to enable pool");
    require(vault.listOfExpiries(pool).length == 0, "position not empty");
    uint length = pools.length;
    require(length < 10, "length >= 10");
    require(!poolAdded[pool], "pool already exists");
    pools.push(pool);
    poolAdded[pool] = true;
    emit AddPool(pool);
  }

  /**
  * @dev Remove an account from pools.
  */
  function removePool(address pool) external onlyOwner {
    require(vault.listOfExpiries(pool).length == 0, "position not empty");
    require(poolAdded[pool], "pool not found");
    uint length = pools.length;
    bool found;
    for (uint i; i < length; i++) {
      if (found) {
        pools[i - 1] = pools[i];
      } else if (pools[i] == pool) {
        found = true;
      }
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
    require(reservedRate <= MAX_RESERVED_RATE, "exceed the limit");
    poolReservedRate[msg.sender] = reservedRate;
    emit SetPoolReservedRate(msg.sender, reservedRate);
  }

  function getPools() external view returns(address[] memory) {
    return pools;
  }
}
