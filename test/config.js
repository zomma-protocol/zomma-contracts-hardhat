const assert = require('assert');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');
const { getContractFactories, expectRevert, expectRevertCustom, createPool, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, buildIv, mergeIv, INT_MAX } = require('./support/helper');

let PoolFactory, Config, Vault, OptionMarket, TestERC20, SpotPricer;
async function setup(stakeholderAccount, insuranceAccount) {
  const usdc = await TestERC20.deploy('USDC', 'USDC', 6);
  const spotPricer = await SpotPricer.deploy();
  const poolFactory = await PoolFactory.deploy();
  const optionPricer = await createOptionPricer();
  const config = await Config.deploy();
  const optionMarket = await OptionMarket.deploy();
  const signatureValidator = await createSignatureValidator();
  const vault = await Vault.deploy();
  await vault.initialize(config.address, spotPricer.address, optionPricer.address, optionMarket.address, signatureValidator.address);
  await config.initialize(vault.address, stakeholderAccount.address, insuranceAccount.address, usdc.address, 6);
  await optionMarket.initialize();
  await optionMarket.setVault(vault.address);
  await optionPricer.reinitialize(config.address, vault.address);
  return { poolFactory, config, vault, usdc, spotPricer, optionPricer, optionMarket };
};

async function createDefaultPool(poolFactory, vault) {
  const { pool } = await createPool(poolFactory, vault.address, `Pool 0 Share`, `P0-SHARE`);
  return pool
}

async function trade(vault, optionMarket, usdc, spotPricer, optionPricer, trader) {
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  await usdc.mint(trader.address, toDecimalStr(1000, 6));
  await usdc.connect(trader).approve(vault.address, toDecimalStr(100000000000, 6));
  await vault.connect(trader).deposit(toDecimalStr(1000));
  await vault.setTimestamp(now);
  await spotPricer.setPrice(toDecimalStr(1000));
  await optionMarket.setIv(mergeIv([
    buildIv(expiry, strike, true, true, toDecimalStr(0.8), false),
    buildIv(expiry, strike, true, false, toDecimalStr(0.8), false)
  ]));
  await optionPricer.updateLookup([expiry]);
  await vault.connect(trader).trade([expiry, toDecimalStr(1100), 1, toDecimalStr(10), INT_MAX], now);
}

describe('Config', () => {
  let stakeholderAccount, insuranceAccount, account1, account2;
  let poolFactory, config, vault, optionMarket, pool, usdc;

  before(async () => {
    [PoolFactory, Config, Vault, OptionMarket, TestERC20, SpotPricer] = await getContractFactories('PoolFactory', 'Config', 'TestVault', 'TestOptionMarket', 'TestERC20', 'TestSpotPricer');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, account1, account2] = accounts;
    ({ poolFactory, config, vault, usdc, optionMarket } = await setup(stakeholderAccount, insuranceAccount));
  });

  describe('#initialize', () => {
    context('when initialize once', () => {
      it('should pass', async () => {
        // assert.equal(await config.initialized(), true);
        assert.equal(await config.vault(), vault.address);
        assert.equal(await config.quote(), usdc.address);
        assert.equal(await config.quoteDecimal(), 6);
        assert.equal(await config.stakeholderAccount(), stakeholderAccount.address);
        assert.equal(await config.insuranceAccount(), insuranceAccount.address);
      });
    });

    context('when initialize twice', () => {
      it('should revert with "Initializable: contract is already initialized"', async () => {
        await expectRevert(config.initialize(vault.address, account1.address, account1.address, usdc.address, 8), 'Initializable: contract is already initialized');
      });
    });
  });

  describe('#setInitialMarginRiskRate', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setInitialMarginRiskRate(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.initialMarginRiskRate()), '0');
        });
      });

      context('when set 1', () => {
        before(async () => {
          await config.setInitialMarginRiskRate(toDecimalStr(1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.initialMarginRiskRate()), '1');
        });
      });

      context('when set 1.000000000000000001', () => {
        it('should revert with OutOfRange', async () => {
          await expectRevertCustom(config.setInitialMarginRiskRate(toDecimalStr('1.000000000000000001')), Config, 'OutOfRange');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setInitialMarginRiskRate(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setLiquidateRate', () => {
    context('when owner', () => {
      context('when clearRate 0', () => {
        before(async () => {
          await config.setClearRate(toDecimalStr(0));
        });

        context('when set 0', () => {
          before(async () => {
            await config.setLiquidateRate(toDecimalStr(0));
          });

          it('should pass', async () => {
            assert.equal(strFromDecimal(await config.liquidateRate()), '0');
          });
        });

        context('when set 1', () => {
          before(async () => {
            await config.setLiquidateRate(toDecimalStr(1));
          });

          it('should pass', async () => {
            assert.equal(strFromDecimal(await config.liquidateRate()), '1');
          });
        });

        context('when set 1.000000000000000001', () => {
          it('should revert with OutOfRange', async () => {
            await expectRevertCustom(config.setLiquidateRate(toDecimalStr('1.000000000000000001')), Config, 'OutOfRange');
          });
        });
      });

      context('when clearRate 0.2', () => {
        before(async () => {
          await config.setClearRate(toDecimalStr(0.2));
        });

        context('when set 0.2', () => {
          before(async () => {
            await config.setLiquidateRate(toDecimalStr(0.2));
          });

          it('should pass', async () => {
            assert.equal(strFromDecimal(await config.liquidateRate()), '0.2');
          });
        });

        context('when set 0.199999999999999999', () => {
          it('should revert with OutOfRange', async () => {
            await expectRevertCustom(config.setLiquidateRate(toDecimalStr('0.199999999999999999')), Config, 'OutOfRange');
          });
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setLiquidateRate(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setClearRate', () => {
    context('when owner', () => {
      context('when liquidateRate 1', () => {
        before(async () => {
          await config.setLiquidateRate(toDecimalStr(1));
        });

        context('when set 0', () => {
          before(async () => {
            await config.setClearRate(toDecimalStr(0));
          });

          it('should pass', async () => {
            assert.equal(strFromDecimal(await config.clearRate()), '0');
          });
        });

        context('when set 1', () => {
          before(async () => {
            await config.setClearRate(toDecimalStr(1));
          });

          it('should pass', async () => {
            assert.equal(strFromDecimal(await config.clearRate()), '1');
          });
        });

        context('when set 1.000000000000000001', () => {
          it('should revert with OutOfRange', async () => {
            await expectRevertCustom(config.setClearRate(toDecimalStr('1.000000000000000001')), Config, 'OutOfRange');
          });
        });
      });

      context('when liquidateRate 0.5', () => {
        before(async () => {
          await config.setClearRate(toDecimalStr(0));
          await config.setLiquidateRate(toDecimalStr(0.5));
        });

        context('when set 0.5', () => {
          before(async () => {
            await config.setClearRate(toDecimalStr(0.5));
          });

          it('should pass', async () => {
            assert.equal(strFromDecimal(await config.clearRate()), '0.5');
          });
        });

        context('when set 0.500000000000000001', () => {
          it('should revert with OutOfRange', async () => {
            await expectRevertCustom(config.setClearRate(toDecimalStr('0.500000000000000001')), Config, 'OutOfRange');
          });
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setClearRate(toDecimalStr(0)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setLiquidationReward', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setLiquidationReward(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.liquidationReward()), '0');
        });
      });

      context('when set 1', () => {
        before(async () => {
          await config.setLiquidationReward(toDecimalStr(1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.liquidationReward()), '1');
        });
      });

      context('when set 1.000000000000000001', () => {
        it('should revert with OutOfRange', async () => {
          await expectRevertCustom(config.setLiquidationReward(toDecimalStr('1.000000000000000001')), Config, 'OutOfRange');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setLiquidationReward(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setMinLiquidation', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setMinLiquidation(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.minLiquidation()), '0');
        });
      });

      context('when set 1000', () => {
        before(async () => {
          await config.setMinLiquidation(toDecimalStr(1000));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.minLiquidation()), '1000');
        });
      });

      // context('when set 1000.000000000000000001', () => {
      //   it('should revert with OutOfRange', async () => {
      //   });
      // });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setMinLiquidation(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setRiskFreeRate', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setRiskFreeRate(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.riskFreeRate()), '0');
        });
      });

      context('when set 1', () => {
        before(async () => {
          await config.setRiskFreeRate(toDecimalStr(1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.riskFreeRate()), '1');
        });
      });

      context('when set -1', () => {
        before(async () => {
          await config.setRiskFreeRate(toDecimalStr(-1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.riskFreeRate()), '-1');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setRiskFreeRate(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setPriceRatio', () => {
    context('when owner', () => {
      context('when priceRatio < priceRatio2', () => {
        before(async () => {
          await config.setPriceRatio(toDecimalStr(0), toDecimalStr(1.1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.priceRatio()), '0');
          assert.equal(strFromDecimal(await config.priceRatio2()), '1.1');
        });
      });

      context('when priceRatio == priceRatio2', () => {
        before(async () => {
          await config.setPriceRatio(toDecimalStr(0.1), toDecimalStr(0.1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.priceRatio()), '0.1');
          assert.equal(strFromDecimal(await config.priceRatio2()), '0.1');
        });
      });

      context('when priceRatio > priceRatio2', () => {
        it('should revert with InvalidRatio', async () => {
          await expectRevertCustom(config.setPriceRatio(toDecimalStr('0.100000000000000001'), toDecimalStr(0.1)), Config, 'InvalidRatio');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setPriceRatio(toDecimalStr(0.1), toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setPriceRatioUtilization', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setPriceRatioUtilization(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.priceRatioUtilization()), '0');
        });
      });

      context('when set 1', () => {
        before(async () => {
          await config.setPriceRatioUtilization(toDecimalStr(1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.priceRatioUtilization()), '1');
        });
      });

      context('when set 1.000000000000000001', () => {
        it('should revert with OutOfRange', async () => {
          await expectRevertCustom(config.setPriceRatioUtilization(toDecimalStr('1.000000000000000001')), Config, 'OutOfRange');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setPriceRatioUtilization(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setSpotFee', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setSpotFee(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.spotFee()), '0');
        });
      });

      context('when set 0.1', () => {
        before(async () => {
          await config.setSpotFee(toDecimalStr(0.1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.spotFee()), '0.1');
        });
      });

      context('when set 0.100000000000000001', () => {
        it('should revert with OutOfRange', async () => {
          await expectRevertCustom(config.setSpotFee(toDecimalStr('0.100000000000000001')), Config, 'OutOfRange');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setSpotFee(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setOptionFee', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setOptionFee(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.optionFee()), '0');
        });
      });

      context('when set 0.2', () => {
        before(async () => {
          await config.setOptionFee(toDecimalStr(0.2));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.optionFee()), '0.2');
        });
      });

      context('when set 0.200000000000000001', () => {
        it('should revert with OutOfRange', async () => {
          await expectRevertCustom(config.setOptionFee(toDecimalStr('0.200000000000000001')), Config, 'OutOfRange');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setOptionFee(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setMinPremium', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setMinPremium(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.minPremium()), '0');
        });
      });

      context('when set 100000', () => {
        before(async () => {
          await config.setMinPremium(toDecimalStr(100000));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.minPremium()), '100000');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setMinPremium(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setExerciseFeeRate', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setExerciseFeeRate(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.exerciseFeeRate()), '0');
        });
      });

      context('when set 0.1', () => {
        before(async () => {
          await config.setExerciseFeeRate(toDecimalStr(0.1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.exerciseFeeRate()), '0.1');
        });
      });

      context('when set 0.100000000000000001', () => {
        it('should revert with OutOfRange', async () => {
          await expectRevertCustom(config.setExerciseFeeRate(toDecimalStr('0.100000000000000001')), Config, 'OutOfRange');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setExerciseFeeRate(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setProfitFeeRate', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setProfitFeeRate(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.profitFeeRate()), '0');
        });
      });

      context('when set 0.5', () => {
        before(async () => {
          await config.setProfitFeeRate(toDecimalStr(0.5));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.profitFeeRate()), '0.5');
        });
      });

      context('when set 0.500000000000000001', () => {
        it('should revert with OutOfRange', async () => {
          await expectRevertCustom(config.setProfitFeeRate(toDecimalStr('0.500000000000000001')), Config, 'OutOfRange');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setProfitFeeRate(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setPoolProportion', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setPoolProportion(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.poolProportion()), '0');
        });
      });

      context('when set 1', () => {
        before(async () => {
          await config.setPoolProportion(toDecimalStr(1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.poolProportion()), '1');
        });
      });

      context('when set 1.000000000000000001', () => {
        it('should revert with OutOfRange', async () => {
          await expectRevertCustom(config.setPoolProportion(toDecimalStr('1.000000000000000001')), Config, 'OutOfRange');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setPoolProportion(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setInsuranceProportion', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await config.setInsuranceProportion(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.insuranceProportion()), '0');
        });
      });

      context('when set 1', () => {
        before(async () => {
          await config.setInsuranceProportion(toDecimalStr(1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.insuranceProportion()), '1');
        });
      });

      context('when set 1.000000000000000001', () => {
        it('should revert with OutOfRange', async () => {
          await expectRevertCustom(config.setInsuranceProportion(toDecimalStr('1.000000000000000001')), Config, 'OutOfRange');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setInsuranceProportion(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setInsuranceAccount', () => {
    context('when owner', () => {
      context('when set not zero address', () => {
        before(async () => {
          await config.setInsuranceAccount(account1.address);
        });

        it('should pass', async () => {
          assert.equal(await config.insuranceAccount(), account1.address);
        });
      });

      context('when set zero address', () => {
        it('should revert with ZeroAddress', async () => {
          await expectRevertCustom(config.setInsuranceAccount(ZERO_ADDRESS), Config, 'ZeroAddress');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setInsuranceAccount(account1.address), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setStakeholderAccount', () => {
    context('when owner', () => {
      context('when set not zero address', () => {
        before(async () => {
          await config.setStakeholderAccount(account1.address);
        });

        it('should pass', async () => {
          assert.equal(await config.stakeholderAccount(), account1.address);
        });
      });

      context('when set zero address', () => {
        it('should revert with ZeroAddress', async () => {
          await expectRevertCustom(config.setStakeholderAccount(ZERO_ADDRESS), Config, 'ZeroAddress');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setStakeholderAccount(account1.address), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setPoolPaused', () => {
    context('when owner', () => {
      before(async () => {
        await config.setPoolPaused(account1.address, 1);
      });

      after(async () => {
        await config.setPoolPaused(account1.address, 2);
      });

      it('should pass', async () => {
        assert.equal(await config.poolPaused(account1.address), 1);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).setPoolPaused(account1.address, 1), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#addPool', () => {
    context('when owner', () => {
      context('when pool does not enable', () => {
        it('should revert with PoolNotEnabled', async () => {
          await expectRevertCustom(config.addPool(stakeholderAccount.address), Config, 'PoolNotEnabled');
        });
      });

      context('when pool enable', () => {
        context('when contract account', () => {
          before(async () => {
            pool = await createDefaultPool(poolFactory, vault);
            await config.addPool(pool.address);
          });

          context('when add once', () => {
            it('should pass', async () => {
              assert.equal((await config.pools(0)), pool.address);
              assert.equal((await config.poolAdded(pool.address)), true);
            });
          });

          context('when add twice', () => {
            it('should revert with DuplicatedPool', async () => {
              await expectRevertCustom(config.addPool(pool.address), Config, 'DuplicatedPool');
            });
          });
        });

        context('when EOA account', () => {
          let config, vault, optionMarket, usdc, spotPricer, optionPricer;

          before(async () => {
            ({ config, vault, usdc, spotPricer, optionPricer, optionMarket } = await setup(stakeholderAccount, insuranceAccount));
            await config.connect(account1).enablePool();
            await config.addPool(account1.address);
          });

          context('when position empty', () => {
            it('should pass', async () => {
              assert.equal((await config.pools(0)), account1.address);
              assert.equal((await config.poolAdded(account1.address)), true);
            });
          });

          context('when position not empty', () => {
            before(async () => {
              await usdc.mint(account1.address, toDecimalStr(1000, 6));
              await usdc.connect(account1).approve(vault.address, toDecimalStr(100000000000, 6));
              await vault.connect(account1).deposit(toDecimalStr(1000));
              await trade(vault, optionMarket, usdc, spotPricer, optionPricer, account2);
              await config.connect(account2).enablePool();
            });

            it('should revert with PositionNotEmpty', async () => {
              await expectRevertCustom(config.addPool(account2.address), Config, 'PositionNotEmpty');
            });
          });
        });
      });

      context('when add pool after 10 pools', () => {
        before(async () => {
          const length = 10 - (await config.getPools()).length;
          for (let i = 0; i < length; ++i) {
            pool = await createDefaultPool(poolFactory, vault);
            await config.addPool(pool.address);
          }
          pool = await createDefaultPool(poolFactory, vault);
        });

        it('should revert with TooManyPools', async () => {
          await expectRevertCustom(config.addPool(pool.address), Config, 'TooManyPools');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).addPool(stakeholderAccount.address), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#removePool', () => {
    let poolFactory, config, vault, optionMarket, usdc, spotPricer, optionPricer, pool;

    before(async () => {
      ({ poolFactory, config, vault, optionMarket, usdc, spotPricer, optionPricer } = await setup(stakeholderAccount, insuranceAccount));
      pool = await createDefaultPool(poolFactory, vault);
      await config.addPool(pool.address);
    });

    context('when owner', () => {
      context('when position empty', () => {
        let pool2, pool3;

        before(async () => {
          pool2 = await createDefaultPool(poolFactory, vault);
          await config.addPool(pool2.address);

          pool3 = await createDefaultPool(poolFactory, vault);
          await config.addPool(pool3.address);
        });

        context('when remove middle pool', () => {
          before(async () => {
            await config.removePool(pool2.address);
          });

          it('should pass', async () => {
            assert.equal((await config.pools(0)),  pool.address);
            assert.equal((await config.pools(1)),  pool3.address);
            assert.equal((await config.getPools()).length, 2);
            assert.equal((await config.poolAdded(pool2.address)), false);
          });
        });

        context('when remove last pool', () => {
          before(async () => {
            await config.removePool(pool3.address);
          });

          it('should pass', async () => {
            assert.equal((await config.pools(0)),  pool.address);
            assert.equal((await config.getPools()).length, 1);
            assert.equal((await config.poolAdded(pool3.address)), false);
          });
        });

        context('when pool does not exist', () => {
          it('should revert with PoolNotFound', async () => {
            await expectRevertCustom(config.removePool(account1.address), Config, 'PoolNotFound');
          });
        });
      });

      context('when position not empty', () => {
        before(async () => {
          await usdc.mint(account1.address, toDecimalStr(1000, 6));
          await usdc.connect(account1).approve(pool.address, toDecimalStr(100000000000, 6));
          await pool.connect(account1).deposit(toDecimalStr(1000));
          await trade(vault, optionMarket, usdc, spotPricer, optionPricer, stakeholderAccount);
        });

        it('should revert with PositionNotEmpty', async () => {
          await expectRevertCustom(config.removePool(pool.address), Config, 'PositionNotEmpty');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(config.connect(account1).removePool(stakeholderAccount.address), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#enablePool', () => {
    before(async () => {
      await config.connect(account1).enablePool();
    });

    it('should pass', async () => {
      assert.equal((await config.poolEnabled(account1.address)),  true);
    });
  });

  describe('#disablePool', () => {
    before(async () => {
      await config.connect(account2).enablePool();
      await config.connect(account2).disablePool();
    });

    it('should pass', async () => {
      assert.equal((await config.poolEnabled(account2.address)),  false);
    });
  });

  describe('#setPoolReservedRate', () => {
    context('when set 0.1', () => {
      before(async () => {
        await config.connect(account1).setPoolReservedRate(toDecimalStr(0.1));
      });

      it('should pass', async () => {
        assert.equal(strFromDecimal((await config.poolReservedRate(account1.address))),  '0.1');
      });
    });

    context('when set 1.000000000000000001', () => {
      it('should revert with OutOfRange', async () => {
        await expectRevertCustom(config.connect(account1).setPoolReservedRate(toDecimalStr('1.000000000000000001')), Config, 'OutOfRange');
      });
    });
  });

  describe('#getPoolReservedRateForTrade', () => {
    before(async () => {
      await config.connect(account1).setPoolReservedRate(toDecimalStr(0.1));
    });

    context('when pool not paused', () => {
      let result;

      before(async () => {
        result = await config.getPoolReservedRateForTrade(account1.address);
      });

      it('should not be first 1', async () => {
        assert.notEqual(result[0],  1);
      });

      it('should be second 0.1', async () => {
        assert.equal(strFromDecimal(result[1]),  '0.1');
      });
    });

    context('when pool paused', () => {
      before(async () => {
        await config.setPoolPaused(account1.address, 1);
        result = await config.getPoolReservedRateForTrade(account1.address);
      });

      after(async () => {
        await config.setPoolPaused(account1.address, 2);
      });

      it('should be first 1', async () => {
        assert.equal(result[0],  1);
      });

      it('should be second 0.1', async () => {
        assert.equal(strFromDecimal(result[1]),  '0.1');
      });
    });
  });
});
