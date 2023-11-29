const assert = require('assert');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');
const { getContractFactories, expectRevert, createPool, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, UINT_MAX } = require('../support/helper');

let Pool, PoolToken, Config, OptionMarket, Vault, TestERC20, SpotPricer, PoolOwner, accounts;
describe('PoolOwner', () => {
  let stakeholderAccount, insuranceAccount, trader, liquidator;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer, vault, pool, poolToken, config, signatureValidator, poolOwner, poolProxy, usdc;

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
    const poolOwner = await PoolOwner.deploy();
    await poolOwner.initialize(pool.address);
    await poolOwner.grantRole('0xeb33521169e672634fcae38dcc3bab0be8a080072000cfbdc0e041665d727c18', liquidator.address);
    await pool.transferOwnership(poolOwner.address);
    const poolProxy = await ethers.getContractAt('TestPool', poolOwner.address);
    return { vault, config, pool, poolToken, usdc, optionMarket, poolOwner, poolProxy };
  };

  before(async () => {
    [Pool, PoolToken, Config, OptionMarket, Vault, TestERC20, SpotPricer, PoolOwner] = await getContractFactories('TestPool', 'PoolToken', 'Config', 'TestOptionMarket', 'TestVault', 'TestERC20', 'TestSpotPricer', 'PoolOwner');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader, liquidator] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer();
    signatureValidator = await createSignatureValidator();
    ({ vault, pool, poolToken, config, poolOwner, poolProxy, usdc } = await setup());
  });

  describe('#initialize', () => {
    context('when initialize once', () => {
      it('should pass', async () => {
        assert.equal(await poolOwner.pool(), pool.address);
        assert.equal(await poolOwner.owner(), stakeholderAccount.address);
        assert.equal(await poolOwner.hasRole('0x0000000000000000000000000000000000000000000000000000000000000000', stakeholderAccount.address), true);
      });
    });

    context('when initialize twice', () => {
      it('should revert with "Initializable: contract is already initialized"', async () => {
        await expectRevert(poolOwner.initialize(pool.address), 'Initializable: contract is already initialized');
      });
    });
  });

  describe('#setReservedRate', () => {
    context('when vaultOwner', () => {
      before(async () => {
        await poolProxy.setReservedRate(toDecimalStr(0));
      });

      it('should be 0', async () => {
        assert.equal(strFromDecimal(await config.poolReservedRate(pool.address)), '0');
      });
    });

    context('when not vaultOwner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(pool.setReservedRate(toDecimalStr(0)), 'Ownable: caller is not the owner');
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(poolProxy.connect(trader).setReservedRate(toDecimalStr(0)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setZlmRate', () => {
    context('when vaultOwner', () => {
      before(async () => {
        await poolProxy.setZlmRate(toDecimalStr(0));
      });

      it('should be 0', async () => {
        assert.equal(strFromDecimal(await pool.zlmRate()), '0');
      });
    });

    context('when not vaultOwner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(pool.setZlmRate(toDecimalStr(0)), 'Ownable: caller is not the owner');
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(poolProxy.connect(trader).setZlmRate(toDecimalStr(0)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setBonusRate', () => {
    context('when vaultOwner', () => {
      before(async () => {
        await poolProxy.setBonusRate(toDecimalStr(0));
      });

      it('should be 0', async () => {
        assert.equal(strFromDecimal(await pool.bonusRate()), '0');
      });
    });

    context('when not vaultOwner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(pool.setBonusRate(toDecimalStr(0)), 'Ownable: caller is not the owner');
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(poolProxy.connect(trader).setBonusRate(toDecimalStr(0)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setWithdrawFeeRate', () => {
    context('when vaultOwner', () => {
      before(async () => {
        await poolProxy.setWithdrawFeeRate(toDecimalStr(0));
      });

      it('should be 0', async () => {
        assert.equal(strFromDecimal(await pool.withdrawFeeRate()), '0');
      });
    });

    context('when not vaultOwner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(pool.setWithdrawFeeRate(toDecimalStr(0)), 'Ownable: caller is not the owner');
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(poolProxy.connect(trader).setWithdrawFeeRate(toDecimalStr(0)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setFreeWithdrawableRate', () => {
    context('when vaultOwner', () => {
      before(async () => {
        await poolProxy.setFreeWithdrawableRate(toDecimalStr(0));
      });

      it('should be 0', async () => {
        assert.equal(strFromDecimal(await pool.freeWithdrawableRate()), '0');
      });
    });

    context('when not vaultOwner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(pool.setFreeWithdrawableRate(toDecimalStr(0)), 'Ownable: caller is not the owner');
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(poolProxy.connect(trader).setFreeWithdrawableRate(toDecimalStr(0)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#withdraw', () => {
    context('when owner', () => {
      let balance, balanceAfter;

      before(async () => {
        await poolOwner.withdrawToken(usdc.address, {
          value: toDecimalStr(1)
        });
        balance = await stakeholderAccount.getBalance();
        await poolOwner.withdraw();
        balanceAfter = await stakeholderAccount.getBalance();
      });

      it('should pass', async () => {
        assert.equal(balanceAfter.gt(balance), true);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(poolOwner.connect(trader).withdraw(), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#withdrawToken', () => {
    context('when owner', () => {
      let balance, balanceAfter;

      before(async () => {
        await usdc.mint(poolOwner.address, toDecimalStr(1, 6));
        balance = await usdc.balanceOf(stakeholderAccount.address);
        await poolOwner.withdrawToken(usdc.address);
        balanceAfter = await usdc.balanceOf(stakeholderAccount.address);
      });

      it('should pass', async () => {
        assert.equal(balanceAfter.gt(balance), true);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(poolOwner.connect(trader).withdrawToken(usdc.address), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#approvePool', () => {
    context('when owner', () => {
      let usdc2;

      before(async () => {
        usdc2 = await TestERC20.deploy('USDC', 'USDC', 18);
        await config.setQuote(usdc2.address, 18);
        await poolProxy.refreshQuote();
        await poolOwner.approvePool();
      });

      after(async () => {
        await config.setQuote(usdc.address, 6);
        await poolProxy.refreshQuote();
      });

      it('should approved', async () => {
        assert.equal(await usdc2.allowance(poolOwner.address, pool.address), UINT_MAX);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(poolOwner.connect(trader).approvePool(), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#withdrawTokenByLiquidator', () => {
    context('when has role', () => {
      let balance, balanceAfter;

      before(async () => {
        await usdc.mint(poolOwner.address, toDecimalStr(1, 6));
        balance = await usdc.balanceOf(liquidator.address);
        await poolOwner.connect(liquidator).withdrawTokenByLiquidator(toDecimalStr(1, 6));
        balanceAfter = await usdc.balanceOf(liquidator.address);
      });

      it('should pass', async () => {
        assert.equal(strFromDecimal(balanceAfter.sub(balance), 6), '1');
      });
    });

    context('when does not have role', () => {
      it('should revert with "AccessControl: account"', async () => {
        await expectRevert(poolOwner.connect(trader).withdrawTokenByLiquidator(1), /AccessControl: account/);
      });
    });
  });

  describe('#transferPoolOwnership', () => {
    context('when owner', () => {
      before(async () => {
        await poolOwner.transferPoolOwnership(stakeholderAccount.address);
      });

      after(async () => {
        await pool.transferOwnership(poolOwner.address);
      });

      it('should pass', async () => {
        assert.equal(await pool.owner(), stakeholderAccount.address);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(poolOwner.connect(trader).transferPoolOwnership(trader.address), 'Ownable: caller is not the owner');
      });
    });
  });
});
