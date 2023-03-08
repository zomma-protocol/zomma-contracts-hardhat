const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal, createOptionPricer, buildIv, mergeIv, addPool, mintAndDeposit, toBigNumber, INT_MAX } = require('../support/helper');

let Vault, Config, TestERC20, SpotPricer, accounts;
describe('Vault', () => {
  let stakeholderAccount, insuranceAccount, trader, pool, pool2;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer;

  const createVault = async (configAddress) => {
    const vault = await Vault.deploy();
    await vault.initialize(configAddress, spotPricer.address, optionPricer.address);
    return vault;
  }

  const setup = async (decimals = 6) => {
    const usdc = await TestERC20.deploy('USDC', 'USDC', decimals);
    const config = await Config.deploy();
    const vault = await createVault(config.address);
    await config.initialize(vault.address, stakeholderAccount.address, insuranceAccount.address, usdc.address, decimals);
    await optionPricer.reinitialize(config.address, vault.address);
    return { vault, config, usdc };
  };

  const setupMarket = async (vault, ivs = [[expiry, strike, true, true, toDecimalStr(0.8), false]]) => {
    await vault.setTimestamp(now);
    await spotPricer.setPrice(toDecimalStr(1000));
    await vault.setIv(mergeIv(ivs.map((iv) => buildIv(...iv))));
    await optionPricer.updateLookup(ivs.map((iv) => iv[0]));
  };

  before(async () => {
    [Vault, Config, TestERC20, SpotPricer] = await getContractFactories('TestVault', 'Config', 'TestERC20', 'TestSpotPricer');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader, pool, pool2] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer(artifacts);
  });

  describe('#withdrawPercent', () => {
    let vault, config, usdc;

    const subSetup = async () => {
      ({ vault, config, usdc } = await setup());
      await setupMarket(vault);
      await addPool(config, pool);
      await addPool(config, pool2);
      await mintAndDeposit(vault, usdc, pool, { mint: 10000000 });
      await mintAndDeposit(vault, usdc, pool2, { mint: 10000000 });
      await mintAndDeposit(vault, usdc, trader, { mint: 10000000 });
      return { vault, config, usdc };
    };

    const reset = async () => {
      await vault.connect(pool).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(1));
      await vault.connect(pool).deposit(toDecimalStr(1000));
      await vault.connect(pool2).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(1));
      await vault.connect(pool2).deposit(toDecimalStr(1000));
    };

    before(async () => {
      ({ vault, config, usdc } = await subSetup());

      const ivs = [];
      for (let i = 0; i < 52; ++i) {
        ivs.push(buildIv(expiry, toDecimalStr(1100 + i), true, true, toDecimalStr(0.8), false));
        ivs.push(buildIv(expiry, toDecimalStr(1100 + i), true, false, toDecimalStr(0.8), false));
      }
      await vault.setIv(mergeIv(ivs));
    });

    context('when 52 positions', () => {
      const positionCount = 52;

      before(async () => {
        for (let i = 0; i < positionCount; ++i) {
          await vault.connect(trader).trade(expiry, toDecimalStr(1100 + i), true, toDecimalStr(0.002), INT_MAX);
        }
      });

      after(async () => {
        await vault.connect(trader).withdraw(toDecimalStr(1000));
        await vault.connect(trader).withdrawPercent(toDecimalStr(0.5), 0, 0);
        await vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, 0);
        await vault.connect(trader).deposit(toDecimalStr(1000));
        await reset();
      });

      context('when rate 1', () => {
        const rate = toDecimalStr(1);

        it('should revert with "withdraw too much"', async () => {
          await expectRevert(vault.connect(pool).withdrawPercent(rate, 0, 0), 'withdraw too much');
        });
      });

      context('when rate 0.5', () => {
        const rate = toDecimalStr('0.5');
        let accountInfoBefore, accountInfo;

        before(async () => {
          accountInfoBefore = await vault.getAccountInfo(pool.address);
          await vault.connect(pool).withdrawPercent(rate, 0, 0);
          accountInfo = await vault.getAccountInfo(pool.address);
        });

        it('should not decrease healthFactor', async () => {
          assert.equal(toBigNumber(accountInfo.healthFactor).gte(toBigNumber(accountInfoBefore.healthFactor)), true);
        });
      });
    });

    context('when 40 positions', () => {
      const positionCount = 40;

      before(async () => {
        for (let i = 0; i < positionCount; ++i) {
          await vault.connect(trader).trade(expiry, toDecimalStr(1100 + i), true, toDecimalStr(0.002), INT_MAX);
        }
      });

      after(async () => {
        await vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, 0);
        await vault.connect(trader).deposit(toDecimalStr(1000));
        await vault.connect(pool).deposit(toDecimalStr(1000));
        await vault.connect(pool2).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(1));
        await vault.connect(pool2).deposit(toDecimalStr(1000));
      });

      context('when rate 1', () => {
        const rate = toDecimalStr('1');
        let accountInfo;

        before(async () => {
          await vault.connect(pool).withdrawPercent(rate, 0, 0);
          accountInfo = await vault.getAccountInfo(pool.address);
        });

        it('should clear', async () => {
          assert.equal(strFromDecimal(accountInfo.equityWithFee), '0');
        });
      });
    });
  });
});
