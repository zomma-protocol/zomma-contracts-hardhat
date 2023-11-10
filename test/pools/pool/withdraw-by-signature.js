const assert = require('assert');
const BigNumber = require('bigNumber.js');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');
const { getContractFactories, expectRevertCustom, createPool, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, INT_MAX, signPoolWithdraw, watchBalance } = require('../../support/helper');

let Pool, PoolToken, Config, OptionMarket, Vault, TestERC20, SpotPricer, accounts;
describe('Pool', () => {
  let stakeholderAccount, insuranceAccount, trader;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer, vault, pool, poolToken, config, signatureValidator;

  const createDefaultPool = async (vault, config) => {
    const { pool, poolToken } = await createPool(vault.address, 'NAME', 'SYMBOL');
    await config.addPool(pool.address);
    return { pool, poolToken };
  };

  const setup = async (decimals = 6) => {
    const usdc = await TestERC20.deploy('USDC', 'USDC', decimals);
    const config = await Config.deploy();
    const optionMarket = await OptionMarket.deploy();
    const vault = await Vault.deploy();
    await vault.setTimestamp(now);
    await vault.initialize(config.address, spotPricer.address, optionPricer.address, optionMarket.address, signatureValidator.address);
    await config.initialize(vault.address, ZERO_ADDRESS, ZERO_ADDRESS, usdc.address, decimals);
    await config.setPoolProportion(toDecimalStr(1));
    await config.setInsuranceProportion(toDecimalStr(1));
    await optionMarket.initialize();
    await optionMarket.setVault(vault.address);
    await optionPricer.reinitialize(config.address, vault.address);
    const { pool, poolToken } = (await createDefaultPool(vault, config));
    await signatureValidator.grantRole('0x2db9fd3d099848027c2383d0a083396f6c41510d7acfd92adc99b6cffcf31e96', pool.address);
    return { vault, config, pool, poolToken, usdc, optionMarket };
  };

  const setupDeposit = async (pool, usdc, from, decimals = 6) => {
    await usdc.mint(from.address, toDecimalStr(10000, decimals));
    await usdc.connect(from).approve(pool.address, toDecimalStr(100000000000, decimals));
    await pool.connect(from).deposit(toDecimalStr(1000));
  };

  const withdrawBySignature = async (pool, signer, shares, acceptableAmount, deadline, gasFee) => {
    return pool.withdrawBySignature(...(await signPoolWithdraw(signatureValidator, signer, shares, acceptableAmount, deadline, gasFee)))
  };

  before(async () => {
    [Pool, PoolToken, Config, OptionMarket, Vault, TestERC20, SpotPricer] = await getContractFactories('TestPool', 'PoolToken', 'Config', 'TestOptionMarket', 'TestVault', 'TestERC20', 'TestSpotPricer');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer();
    signatureValidator = await createSignatureValidator();
    ({ vault, pool, poolToken, config } = await setup());
  });

  describe('#withdrawBySignature', () => {
    let vault, config, pool, poolToken, usdc;

    before(async () => {
      ({ vault, config, pool, poolToken, usdc } = await setup());
    });

    context('when gasFee is -1', () => {
      const gasFee = new BigNumber(INT_MAX).plus(1).toString(10);

      it('should revert with OutOfRange', async () => {
        await expectRevertCustom(withdrawBySignature(pool.connect(trader), trader, toDecimalStr('999.999999999999999'), '0', now, gasFee), Pool, 'OutOfRange');
      });
    });

    context('when gasFee is 0', () => {
      const gasFee = toDecimalStr(0);
      let traderChange;

      before(async () => {
        await setupDeposit(pool, usdc, trader);
        [traderChange] = await watchBalance(usdc, [trader.address], async () => {
          await withdrawBySignature(pool.connect(trader), trader, toDecimalStr('999.999999999999999'), '0', now, gasFee);
        });
      });

      it('should get all', async () => {
        assert.equal(strFromDecimal(traderChange, 6), '1000');
      });
    });

    context('when gasFee is 1', () => {
      const gasFee = toDecimalStr(1);

      context('when sender is trader', () => {
        let traderChange;

        before(async () => {
          await setupDeposit(pool, usdc, trader);
          [traderChange] = await watchBalance(usdc, [trader.address], async () => {
            await withdrawBySignature(pool.connect(trader), trader, toDecimalStr('999.999999999999999'), '0', now, gasFee);
          });
        });

        it('should get all', async () => {
          assert.equal(strFromDecimal(traderChange, 6), '1000');
        });
      });

      context('when sender is not trader', () => {
        context('when withdraw all', () => {
          let traderChange, insuranceAccountChange;

          before(async () => {
            await setupDeposit(pool, usdc, trader);
            [traderChange, insuranceAccountChange] = await watchBalance(usdc, [trader.address, insuranceAccount.address], async () => {
              await withdrawBySignature(pool.connect(insuranceAccount), trader, toDecimalStr('999.999999999999999'), '0', now, gasFee);
            });
          });

          it('should trader get 999', async () => {
            assert.equal(strFromDecimal(traderChange, 6), '999');
          });

          it('should insuranceAccount get 1', async () => {
            assert.equal(strFromDecimal(insuranceAccountChange, 6), '1');
          });
        });

        context('when withdraw 0.1', () => {
          before(async () => {
            await setupDeposit(pool, usdc, trader);
          });

          after(async () => {
            await withdrawBySignature(pool.connect(insuranceAccount), trader, toDecimalStr('999.999999999999999'), '0', now, gasFee);
          });

          it('should revert with GasMoreThanAmount', async () => {
            await expectRevertCustom(withdrawBySignature(pool.connect(insuranceAccount), trader, toDecimalStr('0.01'), '0', now, gasFee), Pool, 'GasMoreThanAmount');
          });
        });
      });
    });

    context('when gasFee is 1.0000001', () => {
      const gasFee = toDecimalStr('1.0000001');
      let traderChange, insuranceAccountChange;

      before(async () => {
        await setupDeposit(pool, usdc, trader);
        [traderChange, insuranceAccountChange] = await watchBalance(usdc, [trader.address, insuranceAccount.address], async () => {
          await withdrawBySignature(pool.connect(insuranceAccount), trader, toDecimalStr('999.999999999999999'), '0', now, gasFee);
        });
      });

      it('should trader get 999', async () => {
        assert.equal(strFromDecimal(traderChange, 6), '999');
      });

      it('should insuranceAccount get 1', async () => {
        assert.equal(strFromDecimal(insuranceAccountChange, 6), '1');
      });
    });
  });
});
