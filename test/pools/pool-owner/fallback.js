const assert = require('assert');
const BigNumber = require('bigNumber.js');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');
const { signData, withSignedData, ivsToPrices, getContractFactories, expectRevertCustom, expectRevert, createPool, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, INT_MAX, signPoolWithdraw, watchBalance, DEAD_ADDRESS } = require('../../support/helper');

let Pool, PoolToken, Config, OptionMarket, Vault, TestERC20, SpotPricer, PoolOwner, accounts;
describe('PoolOwner', () => {
  let stakeholderAccount, insuranceAccount, trader, liquidator;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer, vault, pool, poolToken, usdc, config, signatureValidator, poolOwner, poolProxy, signedData;

  const createDefaultPool = async (vault, config) => {
    const { pool, poolToken } = await createPool(vault.address, 'NAME', 'SYMBOL', 'TestSignedPool');
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
    const poolOwner = await PoolOwner.deploy();
    await poolOwner.initialize(pool.address);
    await poolOwner.grantRole('0x7a8dc26796a1e50e6e190b70259f58f6a4edd5b22280ceecc82b687b8e982869', stakeholderAccount.address);
    await poolOwner.grantRole('0x7a8dc26796a1e50e6e190b70259f58f6a4edd5b22280ceecc82b687b8e982869', insuranceAccount.address);
    await poolOwner.grantRole('0xeb33521169e672634fcae38dcc3bab0be8a080072000cfbdc0e041665d727c18', liquidator.address);
    await pool.transferOwnership(poolOwner.address);
    const poolProxy = await ethers.getContractAt('TestPool', poolOwner.address);
    await signatureValidator.grantRole('0x2db9fd3d099848027c2383d0a083396f6c41510d7acfd92adc99b6cffcf31e96', pool.address);
    return { vault, config, pool, poolToken, usdc, optionMarket, poolOwner, poolProxy };
  };

  const setupDeposit = async (pool, usdc, from, signedData, decimals = 6) => {
    await usdc.mint(from.address, toDecimalStr(10000, decimals));
    await usdc.connect(from).approve(pool.address, toDecimalStr(100000000000, decimals));
    await withSignedData(pool.connect(from), signedData).deposit(toDecimalStr(1000));
  };

  const withdrawBySignature = async (pool, signer, shares, acceptableAmount, deadline, gasFee, signedData = null) => {
    if (!signedData) {
      signedData = await createSignedData();
    }
    return withSignedData(pool, signedData).withdrawBySignature(...(await signPoolWithdraw(signatureValidator, signer, shares, acceptableAmount, deadline, gasFee)))
  };

  const createSignedData = async ({
    spot = toDecimalStr(1000),
    ivs = [[expiry, strike, true, true, toDecimalStr(0.8), false], [expiry, strike, true, false, toDecimalStr(0.8), false]],
    expired = Math.floor(Date.now() / 1000) + 120,
    nowTime = now,
    skipCheckOwner = 0
  } = {}) => {
    return await signData(signatureValidator.address, stakeholderAccount, ivsToPrices(ivs, spot, nowTime), spot, expired, skipCheckOwner);
  };

  before(async () => {
    [Pool, PoolToken, Config, OptionMarket, Vault, TestERC20, SpotPricer, PoolOwner] = await getContractFactories('TestSignedPool', 'PoolToken', 'Config', 'TestOptionMarket', 'TestVault', 'TestERC20', 'TestSpotPricer', 'PoolOwner');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader, liquidator] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer();
    signatureValidator = await createSignatureValidator();
    signedData = await createSignedData({ skipCheckOwner: 1 });
  });

  describe('#withdrawBySignature', () => {
    let vault, config, pool, poolToken, usdc, poolOwner, poolProxy;

    before(async () => {
      ({ vault, config, pool, poolToken, usdc, poolOwner, poolProxy } = await setup());
    });

    context('when gasFee is -1', () => {
      const gasFee = new BigNumber(INT_MAX).plus(1).toString(10);

      it('should revert with OutOfRange', async () => {
        await expectRevertCustom(withdrawBySignature(poolProxy, trader, toDecimalStr('999.999999999999999'), '0', now, gasFee), Pool, 'OutOfRange');
      });
    });

    context('when gasFee is 0', () => {
      const gasFee = toDecimalStr(0);
      let traderChange;

      before(async () => {
        await setupDeposit(pool, usdc, trader, signedData);
        [traderChange] = await watchBalance(usdc, [trader.address], async () => {
          await withdrawBySignature(poolProxy, trader, toDecimalStr('999.999999999999999'), '0', now, gasFee);
        });
      });

      it('should get all', async () => {
        assert.equal(strFromDecimal(traderChange, 6), '1000');
      });
    });

    context('when gasFee is 1', () => {
      const gasFee = toDecimalStr(1);

      context('when sender is not poolOwner', () => {
        before(async () => {
          await setupDeposit(pool, usdc, trader, signedData);
        });

        after(async () => {
          await withdrawBySignature(poolProxy, trader, toDecimalStr('999.999999999999999'), '0', now, gasFee);
        });

        it('should revert with "Ownable: caller is not the owner"', async () => {
          await expectRevert(withdrawBySignature(pool.connect(trader), trader, toDecimalStr('999.999999999999999'), '0', now, gasFee), 'Ownable: caller is not the owner');
        });
      });

      context('when sender is poolOwner', () => {
        context('when sender does not have role', () => {
          before(async () => {
            await setupDeposit(pool, usdc, trader, signedData);
          });

          after(async () => {
            await withdrawBySignature(poolProxy, trader, toDecimalStr('999.999999999999999'), '0', now, gasFee);
          });

          it('should revert with "AccessControl: account"', async () => {
            await expectRevert(withdrawBySignature(poolProxy.connect(trader), trader, toDecimalStr('999.999999999999999'), '0', now, gasFee), /AccessControl: account/);
          });
        });

        context('when sender has role', () => {
          let traderChange, poolOwnerChange;

          before(async () => {
            await setupDeposit(pool, usdc, trader, signedData);
            [traderChange, poolOwnerChange] = await watchBalance(usdc, [trader.address, poolOwner.address], async () => {
              await withdrawBySignature(poolProxy.connect(insuranceAccount), trader, toDecimalStr('999.999999999999999'), '0', now, gasFee);
            });
          });

          it('should trader get 999', async () => {
            assert.equal(strFromDecimal(traderChange, 6), '999');
          });

          it('should poolOwner get 1', async () => {
            assert.equal(strFromDecimal(poolOwnerChange, 6), '1');
          });
        });
      });
    });
  });

  describe('#deposit', () => {
    let vault, config, pool, poolToken, usdc, poolOwner, poolProxy;

    before(async () => {
      ({ vault, config, pool, poolToken, usdc, poolOwner, poolProxy } = await setup());
    });

    context('when sender does not have role', () => {
      it('should revert with "AccessControl: account"', async () => {
        await expectRevert(withSignedData(poolProxy.connect(trader), signedData).deposit(toDecimalStr('1')), /AccessControl: account/);
      });
    });

    context('when sender has role', () => {
      before(async () => {
        await usdc.mint(poolProxy.address, toDecimalStr(10000, 6));
        await withSignedData(poolProxy.connect(liquidator), signedData).deposit(toDecimalStr(1000));
      });

      it('should address(1) get 0.000000000000001 shares', async () => {
        assert.equal(strFromDecimal(await poolToken.balanceOf(DEAD_ADDRESS)), '0.000000000000001');
      });

      it('should user get 999.999999999999999 shares', async () => {
        assert.equal(strFromDecimal(await poolToken.balanceOf(poolOwner.address)), '999.999999999999999');
      });

      it('should be balance 1000 in valut', async () => {
        assert.equal(strFromDecimal(await vault.balanceOf(pool.address)), '1000');
        assert.equal(strFromDecimal(await usdc.balanceOf(poolOwner.address), 6), '9000');
      });
    });
  });

  describe('#withdraw', () => {
    let vault, config, pool, poolToken, usdc, poolOwner, poolProxy;

    before(async () => {
      ({ vault, config, pool, poolToken, usdc, poolOwner, poolProxy } = await setup());
    });

    context('when sender does not have role', () => {
      it('should revert with "AccessControl: account"', async () => {
        await expectRevert(withSignedData(poolProxy.connect(trader), signedData).withdraw(toDecimalStr('999.999999999999999'), '0', now), /AccessControl: account/);
      });
    });

    context('when sender has role', () => {
      before(async () => {
        await usdc.mint(poolProxy.address, toDecimalStr(10000, 6));
        await withSignedData(poolProxy.connect(liquidator), signedData).deposit(toDecimalStr(1000));
        await withSignedData(poolProxy.connect(liquidator), signedData).withdraw(toDecimalStr('999.999999999999999'), '0', now);
      });

      it('should get all', async () => {
        assert.equal(strFromDecimal(await poolToken.balanceOf(DEAD_ADDRESS)), '0');
        assert.equal(strFromDecimal(await poolToken.balanceOf(poolOwner.address)), '0');
        assert.equal(strFromDecimal(await vault.balanceOf(pool.address)), '0');
        assert.equal(strFromDecimal(await usdc.balanceOf(poolOwner.address), 6), '10000');
      });
    });
  });
});
