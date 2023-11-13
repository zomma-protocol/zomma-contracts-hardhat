const assert = require('assert');
const { getContractFactories, expectRevert, expectRevertCustom, toDecimalStr, strFromDecimal, INT_MAX } = require('../support/helper');

let Vault, SpotPricer, Chainlink, ChainlinkProxy, accounts;
describe('SignedSpotPricer', () => {
  let owner, other;
  let spotPricer, chainlink, chainlinkProxy;

  before(async () => {
    [Vault, SpotPricer, Chainlink, ChainlinkProxy] = await getContractFactories('TestVault', 'SignedSpotPricer', 'TestChainlink', 'TestChainlinkProxy');
    accounts = await ethers.getSigners();
    [owner, other] = accounts;
    spotPricer = await SpotPricer.deploy();
    chainlink = await Chainlink.deploy(8);
    chainlinkProxy = await ChainlinkProxy.deploy();

    await chainlink.setDecimals(8);
    await chainlinkProxy.setChainlink(chainlink.address);
    await spotPricer.initialize(chainlinkProxy.address);
  });

  describe('#initialize', () => {
    context('when initialize once', () => {
      it('should pass', async () => {
        assert.equal(await spotPricer.initialized(), true);
        assert.equal(await spotPricer.oracle(), chainlinkProxy.address);
        assert.equal(await spotPricer.owner(), owner.address);
      });
    });

    context('when initialize twice', () => {
      it('should revert with AlreadyInitialized', async () => {
        await expectRevertCustom(spotPricer.initialize(other.address), SpotPricer, 'AlreadyInitialized');
      });
    });
  });

  describe('#setOracle', () => {
    context('when owner', () => {
      before(async () => {
        await spotPricer.setOracle(other.address);
      });
      after(async () => {
        await spotPricer.setOracle(chainlinkProxy.address);
      });

      it('should pass', async () => {
        assert.equal(await spotPricer.oracle(), other.address);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(spotPricer.connect(other).setOracle(other.address), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setValidPeriod', () => {
    context('when owner', () => {
      before(async () => {
        await spotPricer.setValidPeriod(2);
      });
      after(async () => {
        await spotPricer.setValidPeriod(3600);
      });

      it('should pass', async () => {
        assert.equal(await spotPricer.validPeriod(), 2);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(spotPricer.connect(other).setValidPeriod(2), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setMaxPrice', () => {
    context('when owner', () => {
      before(async () => {
        await spotPricer.setMaxPrice(2);
      });
      after(async () => {
        await spotPricer.setMaxPrice(INT_MAX);
      });

      it('should pass', async () => {
        assert.equal(await spotPricer.maxPrice(), 2);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(spotPricer.connect(other).setMaxPrice(2), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setMinPrice', () => {
    context('when owner', () => {
      before(async () => {
        await spotPricer.setMinPrice(2);
      });
      after(async () => {
        await spotPricer.setMinPrice(1);
      });

      it('should pass', async () => {
        assert.equal(await spotPricer.minPrice(), 2);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(spotPricer.connect(other).setMinPrice(2), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#settleByOwner', () => {
    const expiry = 1674201600; // 2023-01-20T08:00:00Z
    const strike = toDecimalStr(1100);

    context('when owner', () => {
      context('when settle once', () => {
        before(async () => {
          await spotPricer.settleByOwner(expiry, strike);
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await spotPricer.settledPrices(expiry)), '1100');
        });
      });

      context('when settle twice', () => {
        it('should revert with Settled', async () => {
          await expectRevertCustom(spotPricer.settleByOwner(expiry, strike), SpotPricer, 'Settled');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(spotPricer.connect(other).settleByOwner(expiry + 1, strike), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#getPrice', () => {
    context('when chainlink decimals 8 ', () => {
      context('when chainlink 1200.12345678', () => {
        before(async () => {
          await chainlink.submit(toDecimalStr('1200.12345678', 8));
        });

        it('should get 1200.12345678', async () => {
          assert.equal(strFromDecimal(await spotPricer.getPrice()), '1200.12345678');
        });
      });
    });

    context('when chainlink decimals 19 ', () => {
      context('when chainlink 1200.1234567891234567899', () => {
        before(async () => {
          await chainlink.setDecimals(19);
          await chainlink.submit(toDecimalStr('1200.1234567891234567899', 19));
        });

        after(async () => {
          await chainlink.setDecimals(8);
        });

        it('should get 1200.123456789123456789', async () => {
          assert.equal(strFromDecimal(await spotPricer.getPrice()), '1200.123456789123456789');
        });
      });
    });
  });

  describe('#settle', () => {
    let initExpiry = 1674201600 + 86400;
    const setupExpiry = async () => {
      expiry = initExpiry;
      initExpiry += 86400;
      await chainlink.setNow(expiry - 60);
      await chainlink.submit(toDecimalStr('1100', 8));
      const roundId = (await chainlink.latestRound());

      await chainlink.setNow(expiry);
      await chainlink.submit(toDecimalStr('1200', 8));
      const roundId2 = (await chainlink.latestRound());
      return { roundId, roundId2, expiry };
    };

    context('when not settled ', () => {
      let expiry, now;

      before(async () => {
        ({ expiry, roundId2 } = await setupExpiry());
        now = expiry + 1;
        await chainlink.setNow(now);
      });

      it('should revert with InvalidRoundId"', async () => {
        await expectRevertCustom(spotPricer.connect(accounts[1]).settle(expiry, roundId2), SpotPricer, 'InvalidRoundId');
      });
    });

    context('when settled ', () => {
      let expiry, now, roundId2;

      before(async () => {
        ({ expiry, roundId2 } = await setupExpiry());
        now = expiry + 1;
        await chainlink.setNow(now);
        await spotPricer.settleByOwner(expiry, toDecimalStr('1300', 8));
      });

      it('should revert with Settled', async () => {
        await expectRevertCustom(spotPricer.connect(accounts[1]).settle(expiry, roundId2), SpotPricer, 'Settled');
      });
    });
  });
});
