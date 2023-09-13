const assert = require('assert');
const BigNumber = require('bigNumber.js');
const { getContractFactories, createPool, buildIv, mergeIv, toDecimal, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, toBigNumber, INT_MAX } = require('../support/helper');

let PoolFactory, Pool, PoolToken, Config, OptionMarket, Vault, TestERC20, SpotPricer;
const initPool = async (owner) => {
  // USDC
  const usdc = await TestERC20.connect(owner).deploy('USDC', 'USDC', 6);
  await usdc.mint(owner.address, '100000000000000000000000000000');

  // SPOT PRICE
  const spotPricer = await SpotPricer.connect(owner).deploy();
  await spotPricer.setPrice(toDecimalStr(1200)); // 1200

  // Pool Factory
  const poolFactory = await PoolFactory.deploy();

  // Option Pricer
  const optionPricer = await createOptionPricer();
  const signatureValidator = await createSignatureValidator();

  // Config
  const config = await Config.connect(owner).deploy();

  // OptionMarket
  const optionMarket = await OptionMarket.connect(owner).deploy();

  const vault = await Vault.connect(owner).deploy();

  await vault.initialize(config.address, spotPricer.address, optionPricer.address, optionMarket.address, signatureValidator.address);
  await config.initialize(vault.address, owner.address, owner.address, usdc.address, 6);
  await optionMarket.initialize();
  await optionMarket.setVault(vault.address);
  await optionPricer.reinitialize(config.address, vault.address);

  const reservedRates = [
    toDecimalStr(0.3),
    toDecimalStr(0.2),
    toDecimalStr(0.1),
    toDecimalStr(0),
  ];

  for (let i = 0; i < reservedRates.length; i++) {
    const reservedRate = reservedRates[i];
    const { pool } = await createPool(poolFactory, vault.address, `Pool ${i} Share`, `P${i}-SHARE`);
    await config.addPool(pool.address);
    await pool.setReservedRate(reservedRate);
  }

  return { usdc, spotPricer, poolFactory, optionPricer, config, vault, optionMarket };
};

describe('Pool', () => {
  let owner, trader;
  let now = 1667548800;

  before(async () => {
    [PoolFactory, Pool, PoolToken, Config, OptionMarket, Vault, TestERC20, SpotPricer] = await getContractFactories('PoolFactory', 'Pool', 'PoolToken', 'Config', 'TestOptionMarket', 'TestVault', 'TestERC20', 'TestSpotPricer');
    accounts = await ethers.getSigners();
    [owner, trader] = accounts;
  });

  describe('#Admin', () => {
    let usdc, spotPricer, poolFactory, optionPricer, config, vault, optionMarket;
    let err;

    before(async () => {
      ({usdc, spotPricer, poolFactory, optionPricer, config, vault, optionMarket} = await initPool(owner))

      const pools = await config.getPools();
      await usdc.mint(owner.address, toDecimalStr(90000, 6));
      for (let i = 0; i < pools.length; ++i) {
        await usdc.approve(pools[i], toDecimalStr(100000000));
        const pool = await ethers.getContractAt('Pool', pools[i]);
        await pool.deposit(toDecimalStr(100000));
      }

      // prepare trader and liquidator balance
      await usdc.mint(trader.address, toDecimalStr(20000, 6));
      await usdc.connect(trader).approve(vault.address, toDecimalStr(100000000000));

      // Prepare current Time is Fri Nov 04 2022 08:00:00 GMT+0000
      await vault.setTimestamp(now);

      error = null;
    });

    it('should be able to set ZLM rate', async () => {
      const pools = await config.getPools();
      const pool1 = await ethers.getContractAt('Pool', pools[0]);

      assert.equal(strFromDecimal(await pool1.zlmRate()), '0.8');

      await pool1.connect(owner).setZlmRate(toDecimalStr("0.785566"));

      assert.equal(strFromDecimal(await pool1.zlmRate()), "0.785566");
    });

    it('should be able to set ZLM bonus rate', async () => {
      const pools = await config.getPools();
      const pool2 = await ethers.getContractAt('Pool', pools[1]);

      assert.equal(strFromDecimal(await pool2.bonusRate()), "0.06");

      await pool2.connect(owner).setBonusRate(toDecimalStr("0.0878787"));

      assert.equal(strFromDecimal(await pool2.bonusRate()), "0.0878787");
    });

    it('should be able to set withdraw fee rate', async () => {
      const pools = await config.getPools();
      const pool3 = await ethers.getContractAt('Pool', pools[2]);

      assert.equal(strFromDecimal(await pool3.withdrawFeeRate()), "0.001");

      await pool3.connect(owner).setWithdrawFeeRate(toDecimalStr("0.005566"));

      assert.equal(strFromDecimal(await pool3.withdrawFeeRate()), "0.005566");
    });
  });

  describe('#Trader', () => {
    let usdc, spotPricer, poolFactory, optionPricer, config, vault;

    before(async () => {
      ({ usdc, spotPricer, poolFactory, optionPricer, config, vault } = await initPool(owner));

      await usdc.connect(trader).mint(trader.address, toDecimalStr(90000));
    });

    it('should be able to stake POOLs', async () => {
      const pools = await config.getPools();

      // preprare account1 money
      await usdc.connect(trader).approve(pools[0], toDecimalStr(100000000000));
      await usdc.connect(trader).approve(pools[1], toDecimalStr(100000000000));

      const pool1 = await ethers.getContractAt('Pool', pools[0]);
      await pool1.connect(trader).deposit(toDecimalStr(5566));

      const pool2 = await ethers.getContractAt('Pool', pools[1]);
      await pool2.connect(trader).deposit(toDecimalStr(7788))

      const token1 = await ethers.getContractAt('PoolToken', await pool1.token());
      const token2 = await ethers.getContractAt('PoolToken', await pool2.token());

      assert.equal(strFromDecimal(await token1.balanceOf(trader.address)), '5566');
      assert.equal(strFromDecimal(await token2.balanceOf(trader.address)), '7788');
    });

    it('should be able to unstake POOLs', async () => {
      const pools = await config.getPools();
      const pool2 = await ethers.getContractAt('Pool', pools[1]);
      const token2 = await ethers.getContractAt('PoolToken', await pool2.token());

      assert.equal(strFromDecimal(await token2.balanceOf(trader.address)), '7788');
      await pool2.connect(trader).withdraw(toDecimalStr(7788), 0);
      assert.equal(strFromDecimal(await token2.balanceOf(trader.address)), '0');
    });
  });

  describe('#ZLM', () => {
    let usdc, spotPricer, poolFactory, optionPricer, config, vault, optionMarket;
    let error;

    before(async() => {
      ({usdc, spotPricer, poolFactory, optionPricer, config, vault, optionMarket} = await initPool(owner));
      await config.setPoolProportion(toDecimalStr(1));

      const pools = await config.getPools();
      await usdc.mint(owner.address, toDecimalStr(90000, 6));
      for (let i = 0; i < pools.length; ++i) {
        await usdc.approve(pools[i], toDecimalStr(10000000000));
        const pool = await ethers.getContractAt('Pool', pools[i]);
        await pool.deposit(toDecimalStr(100000));
      }

      // prepare trader and liquidator balance
      await usdc.mint(trader.address, toDecimalStr(20000000, 6));
      await usdc.connect(trader).approve(vault.address, toDecimalStr(100000000000));

      // Prepare current Time is Fri Nov 04 2022 08:00:00 GMT+0000
      await vault.setTimestamp(now);

      let expiry = 1669968000; //Fri Dec 02 2022 08:00:00 GMT+0000

      const data = [];
      const expiries = [];
      const strikes = [];
      for (let i = 900; i <= 1300; i += 100) {
        strikes.push(toDecimalStr(i));
      }
      for (let i = 0; i < 2; ++i) {
        // console.log(expiry, deploy Date(expiry * 1000));
        for (let strike of strikes) {
          data.push(buildIv(expiry, strike, true, true, toDecimalStr(0.88), false));
          data.push(buildIv(expiry, strike, true, false, toDecimalStr(0.88), false));
          data.push(buildIv(expiry, strike, false, true, toDecimalStr(0.89), false));
          data.push(buildIv(expiry, strike, false, false, toDecimalStr(0.89), false));
        }
        expiries.push(expiry);
        expiry += 86400 * 7;
      }
      await optionMarket.setIv(mergeIv(data));
      await optionPricer.updateLookup(expiries);

      error = null;
    });

    it('should not have bonus when execute ZLM if health factor > 0.8', async () => {
      let expiry = 1669968000; //Fri Dec 02 2022 08:00:00 GMT+0000
      const pools = await config.getPools();
      const pool0 = await ethers.getContractAt('Pool', pools[0]);

      let poolInfo = await vault.getAccountInfo(pools[0]);
      assert.equal(toDecimal(poolInfo.healthFactor).gt(toBigNumber(0.8)), true);

      await usdc.connect(trader).approve(pools[0], toDecimalStr(100000000000));
      await pool0.connect(trader).deposit(toDecimalStr(1234));

      const token = await ethers.getContractAt('PoolToken', await pool0.token());
      const shares = await token.balanceOf(trader.address);

      assert.equal(strFromDecimal(shares), "1234");
    });

    it('should have bonus when execute ZLM if health factor <= 0.8', async () => {
      let expiry = 1669968000; //Fri Dec 02 2022 08:00:00 GMT+0000
      const pools = await config.getPools();
      const pool0 = await ethers.getContractAt('Pool', pools[0]);

      let poolInfo = await vault.getAccountInfo(pools[0]);
      assert.equal(toDecimal(poolInfo.healthFactor).gt(toBigNumber(0.8)), true);

      await vault.connect(trader).deposit(toDecimalStr(10000));
      await vault.connect(trader).trade([expiry, toDecimalStr(1000), 1, toDecimalStr(15), INT_MAX], now);
      await vault.connect(trader).trade([expiry, toDecimalStr(1100), 1, toDecimalStr(15), INT_MAX], now);
      await vault.connect(trader).trade([expiry, toDecimalStr(1200), 1, toDecimalStr(15), INT_MAX], now);
      await vault.connect(trader).trade([expiry, toDecimalStr(1300), 1, toDecimalStr(15), INT_MAX], now);

      expiry += 86400 * 7;
      await vault.connect(trader).trade([expiry, toDecimalStr(1000), 1, toDecimalStr(1.5), INT_MAX], now);
      await vault.connect(trader).trade([expiry, toDecimalStr(1100), 1, toDecimalStr(2), INT_MAX], now);

      poolInfo = await vault.getAccountInfo(pools[0]);

      let token = await ethers.getContractAt('PoolToken', await pool0.token());
      let shares = await token.balanceOf(trader.address);

      await spotPricer.setPrice(toDecimalStr(8350));
      poolInfo = await vault.getAccountInfo(pools[0]);

      const totalShares = await token.totalSupply();
      assert(new BigNumber(poolInfo.equity).div(totalShares.toString(10)).toString(10), "0.07267180888432909817")

      await pool0.connect(trader).deposit(toDecimalStr(1000));
      token = await ethers.getContractAt('PoolToken', await pool0.token());
      shares = await token.balanceOf(trader.address);

      // totalSupply: 101234
      // equity: 8339.545460238578580223
      // 1000 * 1.06 * 101234 / 8339.545460238578580223 + 1234
      assert.equal(strFromDecimal(shares), "14101.372749705008560283");
    });
  });
});
