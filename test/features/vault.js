const assert = require('assert');
const { getContractFactories, expectRevert, createPool, INT_MAX, buildIv, mergeIv, toBigNumber, toDecimal, toDecimalStr, fromDecimal, strFromDecimal, createOptionPricer } = require('../support/helper');

let PoolFactory, Config, Vault, TestERC20, SpotPricer, accounts;
const initVault = async (owner) => {
  // USDC
  const usdc = await TestERC20.connect(owner).deploy('USDC', 'USDC', 6);
  await usdc.mint(owner.address, '100000000000000000000000000000');

  // SPOT PRICE
  const spotPricer = await SpotPricer.connect(owner).deploy();
  await spotPricer.setPrice(toDecimalStr(1200)); // 1200

  // Pool Factory
  const poolFactory = await PoolFactory.deploy();

  // Option Pricer
  const optionPricer = await createOptionPricer(artifacts);

  // Config
  const config = await Config.connect(owner).deploy();

  const vault = await Vault.connect(owner).deploy();

  await vault.initialize(config.address, spotPricer.address, optionPricer.address);
  await config.initialize(vault.address, owner.address, owner.address, usdc.address, 6);
  await optionPricer.reinitialize(config.address, vault.address);

  return { usdc, spotPricer, poolFactory, optionPricer, config, vault };
};

describe('Vault', () => {
  let owner, trader, liquidator;

  before(async () => {
    [PoolFactory, Config, Vault, TestERC20, SpotPricer] = await getContractFactories('PoolFactory', 'Config', 'TestVault', 'TestERC20', 'TestSpotPricer');
    accounts = await ethers.getSigners();
    [owner, trader, liquidator] = accounts;
  });

  describe('#Admin', () => {
    let usdc, spotPricer, poolFactory, optionPricer, config, vault;

    before(async () => {
      ({usdc, spotPricer, poolFactory, optionPricer, config, vault} = await initVault(owner));

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
      await vault.setTimestamp(1667548800);

      error = null;
    });

    // beforeEach(async () => {
    // });

    it('should be able to init first time', async () => {
      assert.equal(await vault.initialized(), true);
    });

    it('should not be allowed to init second time', async () => {
      await expectRevert(
        vault.initialize(config.address, spotPricer.address, optionPricer.address), 'already initialized'
      );
    });

    it('should be able to set IVs', async () => {
      let data = [];
      const expiry = 1669968000; //Fri Dec 02 2022 08:00:00 GMT+0000
      const strike = toDecimalStr(800);
      data.push(buildIv(expiry, strike, true, true, toDecimalStr(0.9), false));

      await vault.setIv(mergeIv(data));
      await optionPricer.updateLookup([expiry]);
      assert.equal(strFromDecimal((await vault.getMarketIv(1669968000, strike, true, true))), '0.9');

      data = [];
      data.push(buildIv(expiry, strike, true, true, toDecimalStr(0.95), false));
      await vault.setIv(mergeIv(data));
      await optionPricer.updateLookup([expiry]);
      assert.equal(strFromDecimal((await vault.getMarketIv(1669968000, strike, true, true))), '0.95');
    });

    it('should be able to disable trade', async () => {
      const expiry = 1669968000; //Fri Dec 02 2022 08:00:00 GMT+0000
      const expiry2 = 1670572800; //Fri Dec 09 2022 08:00:00 GMT+0000

      const data = []
      data.push(buildIv(expiry, toDecimalStr(900), true, true, toDecimalStr(0.8), false));
      data.push(buildIv(expiry, toDecimalStr(1000), true, true, toDecimalStr(0.8), false));
      data.push(buildIv(expiry, toDecimalStr(1000), true, false, toDecimalStr(0.8), false));
      data.push(buildIv(expiry, toDecimalStr(1100), true, true, toDecimalStr(0.8), false));
      data.push(buildIv(expiry2, toDecimalStr(900), true, true, toDecimalStr(0.8), false));
      data.push(buildIv(expiry2, toDecimalStr(1000), true, true, toDecimalStr(0.8), false));
      data.push(buildIv(expiry2, toDecimalStr(1000), true, false, toDecimalStr(0.8), false));
      data.push(buildIv(expiry2, toDecimalStr(1100), true, true, toDecimalStr(0.8), false));
      await vault.setIv(mergeIv(data));

      await optionPricer.updateLookup([expiry]);
      await optionPricer.updateLookup([expiry2]);

      await vault.setTradeDisabled(true);

      await vault.connect(trader).deposit(toDecimalStr(10000));
      assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), "10000");

      await expectRevert(vault.connect(trader).trade(expiry, toDecimalStr(1000), true, toDecimalStr(1), INT_MAX), 'trade disabled')

      await expectRevert(vault.connect(trader).trade(expiry2, toDecimalStr(1000), true, toDecimalStr(1), INT_MAX), 'trade disabled')


      await vault.setTradeDisabled(false);

      result = await (await vault.connect(trader).trade(expiry, toDecimalStr(1000), true, toDecimalStr(1), INT_MAX)).wait();

      assert.equal(result.status, true);

      result = await (await vault.connect(trader).trade(expiry2, toDecimalStr(1000), true, toDecimalStr(1), INT_MAX)).wait();

      assert.equal(result.status, true);
    });

    it('should be able to disable expired date', async () => {
      const expiry = 1669968000; //Fri Dec 02 2022 08:00:00 GMT+0000
      const expiry2 = 1670572800; //Fri Dec 09 2022 08:00:00 GMT+0000

      const data = []
      data.push(buildIv(expiry, toDecimalStr(900), true, true, toDecimalStr(0.8), false));
      data.push(buildIv(expiry, toDecimalStr(1000), true, true, toDecimalStr(0.8), false));
      data.push(buildIv(expiry, toDecimalStr(1000), true, false, toDecimalStr(0.8), false));
      data.push(buildIv(expiry, toDecimalStr(1100), true, true, toDecimalStr(0.8), false));

      data.push(buildIv(expiry2, toDecimalStr(900), true, true, toDecimalStr(0.8), false));
      data.push(buildIv(expiry2, toDecimalStr(1000), true, true, toDecimalStr(0.8), false));
      data.push(buildIv(expiry2, toDecimalStr(1000), true, false, toDecimalStr(0.8), false));
      data.push(buildIv(expiry2, toDecimalStr(1100), true, true, toDecimalStr(0.8), false));

      await vault.setIv(mergeIv(data));

      await optionPricer.updateLookup([expiry]);
      await optionPricer.updateLookup([expiry2]);

      result = await (await vault.connect(trader).trade(expiry, toDecimalStr(1000), true, toDecimalStr(1), INT_MAX)).wait();

      assert.equal(result.status, true)

      result = await (await vault.connect(trader).trade(expiry2, toDecimalStr(1000), true, toDecimalStr(1), INT_MAX)).wait();

      assert.equal(result.status, true)

      await vault.setExpiryDisabled(expiry2, true);

      result = await (await vault.connect(trader).trade(expiry, toDecimalStr(1000), true, toDecimalStr(1), INT_MAX)).wait();

      assert.equal(result.status, true)

      await expectRevert(vault.connect(trader).trade(expiry2, toDecimalStr(1000), true, toDecimalStr(1), INT_MAX), 'trade disabled')
    });
  });

  describe('#Trader', () => {
    let usdc, spotPricer, poolFactory, optionPricer, config, vault;

    before(async () => {
      ({ usdc, spotPricer, poolFactory, optionPricer, config, vault } =
        await initVault(owner));

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

      const pools = await config.getPools();
      await usdc.mint(owner.address, toDecimalStr(90000000000));
      for (let i = 0; i < pools.length; ++i) {
        await usdc.approve(pools[i], toDecimalStr(100000000));
        const pool = await ethers.getContractAt('Pool', pools[i]);
        await pool.deposit(toDecimalStr(100000));
      }

      await usdc.connect(trader).mint(trader.address, toDecimalStr(90000));
      await usdc.connect(trader).approve(vault.address, toDecimalStr(100000000000));

      // Prepare current Time is Fri Nov 04 2022 08:00:00 GMT+0000
      await vault.setTimestamp(1667548800);

      // Prepare expiry Fri Nov 11 2022 08:00:00 GMT+0000
      let expiry = 1668153600;

      const data = [];
      const expiries = [];
      const strikes = [];
      for (let i = 1000; i <= 1300; i += 100) {
        strikes.push(toDecimalStr(i));
      }
      for (let i = 0; i < 2; ++i) {
        // console.log(expiry, deploy Date(expiry * 1000));
        for (let strike of strikes) {
          data.push(buildIv(expiry, strike, true, true, toDecimalStr(0.85), false));
          data.push(buildIv(expiry, strike, true, false, toDecimalStr(0.85), false));
          data.push(buildIv(expiry, strike, false, true, toDecimalStr(0.85), false));
          data.push(buildIv(expiry, strike, false, false, toDecimalStr(0.85), false));
        }
        expiries.push(expiry);
        expiry += 86400 * 7;
      }
      await vault.setIv(mergeIv(data));
      await optionPricer.updateLookup(expiries);
    });

    it('should be able to deposit USDC for trade', async () => {
      await vault.connect(trader).deposit(toDecimalStr(1234));
      assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), '1234');
    });

    it('should be able to withdraw USDC in trade', async () => {
      await vault.connect(trader).withdraw(toDecimalStr(1230));
      assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), '4');
    });

    it('should not be trade if valut has no specific strike', async () => {
      let expiry = 1668153600;
      await expectRevert(vault.connect(trader).trade(expiry, toDecimalStr(100), true, toDecimalStr(10), INT_MAX), 'iv is 0')
    });

    it('should not be trade if trader has no enough money', async () => {
      let expiry = 1668153600;
      await expectRevert(vault.connect(trader).trade(expiry, toDecimalStr(1000), true, toDecimalStr(10), INT_MAX), 'unavailable')
    });

    it('should be able to make a buy call', async () => {
      let expiry = 1668153600;

      await vault.connect(trader).deposit(toDecimalStr(199996));
      assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), '200000');

      const result = await (await vault.connect(trader).trade(expiry, toDecimalStr(1000), true, toDecimalStr(1), INT_MAX)).wait();
      assert.equal(result.status, true);
    })

    it('should be able to make a buy put', async () => {});
    it('should be able to make a sell call', async () => {});
    it('should be able to make a sell put', async () => {});
  });

  describe('#Liquidator', () => {
    let error;
    let usdc, spotPricer, poolFactory, settler, optionPricer, config, vault;

    before(async () => {
      ({usdc, spotPricer, poolFactory, settler, optionPricer, config, vault} = await initVault(owner));

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

      const pools = await config.getPools();
      await usdc.mint(owner.address, toDecimalStr(90000, 6));
      for (let i = 0; i < pools.length; ++i) {
        await usdc.approve(pools[i], toDecimalStr(100000000));
        const pool = await ethers.getContractAt('Pool', pools[i]);
        await pool.deposit(toDecimalStr(100000));
      }

      // prepare trader and liquidator balance
      await usdc.mint(trader.address, toDecimalStr(2000, 6));
      await usdc.connect(trader).approve(vault.address, toDecimalStr(100000000000));

      await usdc.mint(liquidator.address, toDecimalStr(10000, 6));
      await usdc.connect(liquidator).approve(vault.address, toDecimalStr(100000000000));

      // Prepare current Time is Fri Nov 04 2022 08:00:00 GMT+0000
      await vault.setTimestamp(1667548800);

      // Prepare expiry Fri Nov 11 2022 08:00:00 GMT+0000
      let expiry = 1668153600;

      const data = [];
      const expiries = [];
      const strikes = [];
      for (let i = 1000; i <= 1300; i += 100) {
        strikes.push(toDecimalStr(i));
      }
      for (let i = 0; i < 2; ++i) {
        // console.log(expiry, deploy Date(expiry * 1000));
        for (let strike of strikes) {
          data.push(buildIv(expiry, strike, true, true, toDecimalStr(0.85), false));
          data.push(buildIv(expiry, strike, true, false, toDecimalStr(0.85), false));
          data.push(buildIv(expiry, strike, false, true, toDecimalStr(0.85), false));
          data.push(buildIv(expiry, strike, false, false, toDecimalStr(0.85), false));
        }
        expiries.push(expiry);
        expiry += 86400 * 7;
      }
      await vault.setIv(mergeIv(data));
      await optionPricer.updateLookup(expiries);

      error = null;
    });

    it('is required that health factor of trader be greater than 0.5 after deposit', async () => {
      await vault.connect(trader).deposit(toDecimalStr(1000));
      assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), "1000");

      const accountInfo = await vault.getAccountInfo(trader.address)
      assert.equal(toDecimal(accountInfo.healthFactor).gt(toBigNumber(0.5)), true);
    })

    it('is required that health factor of liquidator be greater than 0.5 after deposit', async () => {
      await vault.connect(liquidator).deposit(toDecimalStr(1000));
      assert.equal(strFromDecimal(await vault.balanceOf(liquidator.address)), "1000");

      const accountInfo = await vault.getAccountInfo(liquidator.address);
      assert.equal(toDecimal(accountInfo.healthFactor).gt(toBigNumber(0.5)), true);
    })

    it('should not be able to liquidate trader if trader`s health factor > 0.5', async () => {
      // Prepare expiry Fri Nov 11 2022 08:00:00 GMT+0000
      const expiry = 1668153600;

      await vault.connect(trader).trade(expiry, toDecimalStr(1000), true, toDecimalStr(1), INT_MAX)

      // console.log(fromDecimal(await vault.balanceOf(trader)));
      const accountInfo = await vault.getAccountInfo(trader.address)
      assert.equal(toDecimal(accountInfo.healthFactor).gt(toBigNumber(0.5)), true);
    })

    it("should be able to create many different positions", async () => {
      // Prepare expiry Fri Nov 11 2022 08:00:00 GMT+0000
      const expiry = 1668153600;

      let result = await (await vault.connect(trader).trade(expiry, toDecimalStr(1000), true, toDecimalStr(-4), 0)).wait();
      assert.equal(result.status, true);

      result = await (await vault.connect(trader).trade(expiry, toDecimalStr(1200), true, toDecimalStr(-3), 0)).wait();
      assert.equal(result.status, true);

      result = await (await vault.connect(trader).trade(expiry, toDecimalStr(1100), true, toDecimalStr(-1), 0)).wait();
      assert.equal(result.status, true);

      result = await (await vault.connect(trader).trade(expiry, toDecimalStr(1300), true, toDecimalStr(-1), 0)).wait();
      assert.equal(result.status, true);

      result = await (await vault.connect(trader).trade(expiry, toDecimalStr(1100), true, toDecimalStr(2), INT_MAX)).wait();
      assert.equal(result.status, true);
    })

    it('should have health factor >= 1', async () => {
      let accountInfo = await vault.getAccountInfo(trader.address);
      assert.equal(fromDecimal(accountInfo.healthFactor).gte(toBigNumber(1.0)), true);
    })

    it('should not be able to liquidate trader if health factor >= 0.5', async () => {
      // Prepare expiry Fri Nov 11 2022 08:00:00 GMT+0000
      const expiry = 1668153600;
      // set price to 1280
      await spotPricer.setPrice(toDecimalStr(1280));
      accountInfo = await vault.getAccountInfo(trader.address);
      assert.equal(fromDecimal(accountInfo.healthFactor).gte(toBigNumber(0.5)), true);

      await expectRevert(vault.connect(liquidator).liquidate(trader.address, expiry, toDecimalStr(1100), true, toDecimalStr(1)), "can't liquidate")
    })

    it('should be able to liquidate trader if health factor <= 0.5', async () => {
      // Prepare expiry Fri Nov 11 2022 08:00:00 GMT+0000
      const expiry = 1668153600;

      // market price increase
      await spotPricer.setPrice(toDecimalStr(1310));

      // console.log(fromDecimal(await config.liquidationReward()).toString());

      accountInfo = await vault.getAccountInfo(trader.address);
      assert.equal(fromDecimal(accountInfo.healthFactor).lt(toBigNumber(0.5)), true);

      accountInfo = await vault.getAccountInfo(liquidator.address);
      // console.log(accountInfo);

      // console.log(strFromDecimal(await vault.balanceOf(liquidator)));

      await vault.connect(liquidator).liquidate(trader.address, expiry, toDecimalStr(1000), true, toDecimalStr(1));

      expires = await vault.listOfExpiries(liquidator.address);
      assert.equal(expires.length === 1, true)

      expire = expires[0].toNumber();
      const strikes = Array.from(await vault.listOfStrikes(liquidator.address, expire));
      strike = strikes[0]
      position = await vault.positionOf(liquidator.address, expire, strike.toString(), true)
      console.log(strFromDecimal(await vault.balanceOf(liquidator.address)));
    })

    it('should have exactly more 10% balanceOf after liquidate', async() => {

    })

    it("should not be able to liquidate buy position at first", async () => {
      // Prepare expiry Fri Nov 11 2022 08:00:00 GMT+0000
      const expiry = 1668153600;

      // market price increase
      await spotPricer.setPrice(toDecimalStr(1310));

      accountInfo = await vault.getAccountInfo(trader.address);
      assert.equal(fromDecimal(accountInfo.healthFactor).lt(toBigNumber(0.5)), true);

      await expectRevert(vault.connect(liquidator).liquidate(trader.address, expiry, toDecimalStr(1100), true, toDecimalStr(1)), 'sell position first');
    });

    it("should not be able to liquidate trader once remaing health factor greater than 0.5", async () => {
      // Prepare expiry Fri Nov 11 2022 08:00:00 GMT+0000
      const expiry = 1668153600;

      await vault.connect(liquidator).liquidate(trader.address, expiry, toDecimalStr(1000), true, toDecimalStr(1))
      accountInfo = await vault.getAccountInfo(trader.address);
      assert.equal(fromDecimal(accountInfo.healthFactor).lt(toBigNumber(0.5)), true);

      await vault.connect(liquidator).liquidate(trader.address, expiry, toDecimalStr(1200), true, toDecimalStr(2))
      accountInfo = await vault.getAccountInfo(trader.address);
      assert.equal(fromDecimal(accountInfo.healthFactor).gte(toBigNumber(0.5)), true);

      await expectRevert(vault.connect(liquidator).liquidate(trader.address, expiry, toDecimalStr(1200), true, toDecimalStr(1)), "can't liquidate");
    })
  });
});
