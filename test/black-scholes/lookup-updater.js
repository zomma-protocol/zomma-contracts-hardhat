const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal } = require('../support/helper');

let LookupUpdater;
describe('LookupUpdater', () => {
  let lookupUpdater;

  before(async () => {
    [LookupUpdater] = await getContractFactories('LookupUpdater');
    lookupUpdater = await LookupUpdater.deploy();
    lookupUpdater.exp = lookupUpdater['exp(int256)'];
  });

  describe('#sqrt', () => {
    context('when sqrt(0)', () => {
      it('should be 0', async () => {
        assert.equal(strFromDecimal(await lookupUpdater.sqrt(0)), '0');
      });
    });

    context('when sqrt(2)', () => {
      it('should be 1.414213562373095048', async () => {
        assert.equal(strFromDecimal(await lookupUpdater.sqrt(toDecimalStr(toDecimalStr(2)))), '1.414213562373095048');
      });
    });
  });

  describe('#exp', () => {
    context('when exp(0)', () => {
      it('should be 1', async () => {
        assert.equal(strFromDecimal(await lookupUpdater.exp(0)), '1');
      });
    });

    context('when exp(2)', () => {
      it('should be 7.389056098930650224', async () => {
        assert.equal(strFromDecimal(await lookupUpdater.exp(toDecimalStr('2'))), '7.389056098930650224');
      });
    });

    context('when exp(0.00001)', () => {
      it('should be 1.000010000050000166', async () => {
        assert.equal(strFromDecimal(await lookupUpdater.exp(toDecimalStr('0.00001'))), '1.000010000050000166');
      });
    });

    context('when exp(0.693147180559945309)', () => {
      it('should be 2', async () => {
        assert.equal(strFromDecimal(await lookupUpdater.exp(toDecimalStr('0.693147180559945309'))), '2');
      });
    });

    context('when exp(-0.693147180559945309)', () => {
      it('should be 0.5', async () => {
        assert.equal(strFromDecimal(await lookupUpdater.exp(toDecimalStr('-0.693147180559945309'))), '0.5');
      });
    });

    context('when exp(-42)', () => {
      it('should be 0', async () => {
        assert.equal(strFromDecimal(await lookupUpdater.exp(toDecimalStr(-42))), '0');
      });
    });

    context('when exp(100)', () => {
      it('should be 26881171418161356081172547590863453358990658.240212544679575552', async () => {
        assert.equal(strFromDecimal(await lookupUpdater.exp(toDecimalStr(100))), '26881171418161356081172547590863453358990658.240212544679575552');
      });
    });

    context('when exp(100.000000000000000001)', () => {
      it('should revert with "cannot handle exponents greater than 100"', async () => {
        await expectRevert(lookupUpdater.exp(toDecimalStr('100.000000000000000001')), 'cannot handle exponents greater than 100');
      });
    });
  });
});
