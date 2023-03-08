const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal, createOptionPricer, buildIv, mergeIv, addPool, mintAndDeposit, INT_MAX } = require('./support/helper');

let Vault, Config, TestERC20, SpotPricer, Settler, accounts;
describe('Settler', () => {
  let stakeholderAccount, insuranceAccount, trader, trader2, pool, otherAccount;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer, vault, config, usdc, settler;

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

  const setupMarket = async (vault, ivs = [[expiry, strike, true, true, toDecimalStr(0.8), false], [expiry, strike, true, false, toDecimalStr(0.8), false]]) => {
    await vault.setTimestamp(now);
    await spotPricer.setPrice(toDecimalStr(1000));
    await vault.setIv(mergeIv(ivs.map((iv) => buildIv(...iv))));
    await optionPricer.updateLookup(ivs.map((iv) => iv[0]));
  };

  before(async () => {
    [Vault, Config, TestERC20, SpotPricer, Settler] = await getContractFactories('TestVault', 'Config', 'TestERC20', 'TestSpotPricer', 'TestSettler');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader, trader2, pool, otherAccount] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer();
    ({ vault, config, usdc } = await setup());
    settler = await Settler.deploy();
    await settler.initialize(vault.address);
  });

  describe('#initialize', () => {
    context('when initialize once', () => {
      it('should pass', async () => {
        assert.equal(await settler.initialized(), true);
        assert.equal(await settler.vault(), vault.address);
      });
    });

    context('when initialize twice', () => {
      it('should revert with "already initialized"', async () => {
        await expectRevert(settler.initialize(trader.address), 'already initialized');
      });
    });
  });

  describe('#settle', () => {
    let position, position2;

    before(async () => {
      await setupMarket(vault);
      await addPool(config, pool);
      await mintAndDeposit(vault, usdc, pool);
      await mintAndDeposit(vault, usdc, trader);
      await mintAndDeposit(vault, usdc, trader2);
      await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-1), 0);
      await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(-1), 0);
      await vault.setTimestamp(expiry);
      await spotPricer.setSettledPrice(expiry, toDecimalStr(1050));
      await settler.settle(expiry, [trader.address, trader2.address]);
      position = await vault.positionOf(trader.address, expiry, strike, true);
      position2 = await vault.positionOf(trader2.address, expiry, strike, true);
    });

    it('should trader size 0', async () => {
      assert.equal(strFromDecimal(position.size), '0');
    });

    it('should trader2 size 0', async () => {
      assert.equal(strFromDecimal(position2.size), '0');
    });
  });
});
