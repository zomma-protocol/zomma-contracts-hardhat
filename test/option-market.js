const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal, buildIv, mergeIv } = require('./support/helper');

let OptionMarket, accounts;
describe('OptionMarket', () => {
  let owner, trader;
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let optionMarket;

  const setup = async () => {
    const optionMarket = await OptionMarket.deploy();
    return { optionMarket };
  };

  before(async () => {
    [OptionMarket] = await getContractFactories('OptionMarket');
    accounts = await ethers.getSigners();
    [owner, trader] = accounts;
    ({ optionMarket } = await setup());
  });

  describe('#setIv', () => {
    context('when owner', () => {
      context('when invalid data', () => {
        it('should revert with "invalid length"', async () => {
          await expectRevert(optionMarket.setIv([1]), 'invalid length');
        });
      });

      context('when valid data', () => {
        beforeEach(async () => {
          await optionMarket.setIv(mergeIv([
            buildIv(expiry, strike, true, true, toDecimalStr(0.8), true),
            buildIv(expiry, strike, true, false, toDecimalStr('0.700000019'), false),
            buildIv(expiry, strike, false, true, toDecimalStr(0.6), false),
            buildIv(expiry, strike, false, false, toDecimalStr(0.5), true)
          ]));
        });

        afterEach(async () => {
          await optionMarket.setIv(mergeIv([
            buildIv(expiry, strike, true, true, toDecimalStr(0.8), false),
            buildIv(expiry, strike, true, false, toDecimalStr(0.8), false),
            buildIv(expiry, strike, false, true, toDecimalStr(0.8), false),
            buildIv(expiry, strike, false, false, toDecimalStr(0.8), false)
          ]));
        });

        it('should set ivs', async () => {
          assert.equal(strFromDecimal(await optionMarket.getMarketIv(expiry, strike, true, true)), '0.8');
          assert.equal(strFromDecimal(await optionMarket.getMarketIv(expiry, strike, true, false)), '0.70000001');
          assert.equal(strFromDecimal(await optionMarket.getMarketIv(expiry, strike, false, true)), '0.6');
          assert.equal(strFromDecimal(await optionMarket.getMarketIv(expiry, strike, false, false)), '0.5');
          assert.equal(await optionMarket.isMarketDisabled(expiry, strike, true, true), true);
          assert.equal(await optionMarket.isMarketDisabled(expiry, strike, true, false), false);
          assert.equal(await optionMarket.isMarketDisabled(expiry, strike, false, true), false);
          assert.equal(await optionMarket.isMarketDisabled(expiry, strike, false, false), true);
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(optionMarket.connect(trader).setIv(mergeIv([buildIv(expiry, strike, true, true, toDecimalStr(0.8), false)])), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setTradeDisabled', () => {
    context('when owner', () => {
      context('when set false', () => {
        beforeEach(async () => {
          await optionMarket.setTradeDisabled(false);
        });

        it('should be false', async () => {
          assert.equal(await optionMarket.tradeDisabled(), false);
        });
      });

      context('when set true', () => {
        beforeEach(async () => {
          await optionMarket.setTradeDisabled(true);
        });

        afterEach(async () => {
          await optionMarket.setTradeDisabled(false);
        });

        it('should be true', async () => {
          assert.equal(await optionMarket.tradeDisabled(), true);
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(optionMarket.connect(trader).setTradeDisabled(true), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setExpiryDisabled', () => {
    context('when owner', () => {
      context('when set false', () => {
        beforeEach(async () => {
          await optionMarket.setExpiryDisabled(expiry, false);
        });

        it('should be false', async () => {
          assert.equal(await optionMarket.expiryDisabled(expiry), false);
        });
      });

      context('when set true', () => {
        beforeEach(async () => {
          await optionMarket.setExpiryDisabled(expiry, true);
        });

        afterEach(async () => {
          await optionMarket.setExpiryDisabled(expiry, false);
        });

        it('should be true', async () => {
          assert.equal(await optionMarket.expiryDisabled(expiry), true);
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(optionMarket.connect(trader).setExpiryDisabled(expiry, true), 'Ownable: caller is not the owner');
      });
    });
  });
});
