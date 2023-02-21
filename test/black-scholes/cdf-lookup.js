const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal } = require('../support/helper');
const cdf = require('../../scripts/cdf');

let CdfLookup;
describe('CdfLookup', () => {
  let cdfLookup;

  before(async () => {
    [CdfLookup] = await getContractFactories('CdfLookup');
    cdfLookup = await CdfLookup.deploy();
    const chunkSize = 200;
    for (let i = 0; i < cdf.keys.length; i += chunkSize) {
      await cdfLookup.setCdf(cdf.keys.slice(i, i + chunkSize), cdf.values.slice(i, i + chunkSize));
    }
    await cdfLookup.freezeCdf();
  });

  describe('#freezeCdf', () => {
    it('should be frozenCdf true', async () => {
      assert.equal(await cdfLookup.frozenCdf(), true);
    });
  });

  describe('#setCdf', () => {
    context('when frozenCdf false', () => {
      let cdfLookup;

      before(async () => {
        cdfLookup = await CdfLookup.deploy();
      });

      context('when different length', () => {
        it('should revert with "incorrect length"', async () => {
          await expectRevert(cdfLookup.setCdf(cdf.keys.slice(0, 1), cdf.values.slice(0, 2)), 'incorrect length');
        });
      });

      context('when same length', () => {
        beforeEach(async () => {
          await cdfLookup.setCdf(cdf.keys.slice(0, 1), cdf.values.slice(0, 1));
        });

        it('should pass', async () => {
          assert.equal(await cdfLookup.CDF(cdf.keys[0]), cdf.values[0]);
        });
      });
    });

    context('when frozenCdf true', () => {
      it('should revert with "frozen"', async () => {
        await expectRevert(cdfLookup.setCdf(cdf.keys.slice(0, 1), cdf.values.slice(0, 1)), 'frozen');
      });
    });
  });

  describe('#cdf', () => {
    context('when cdf(6)', () => {
      it('should be 1', async () => {
        assert.equal(strFromDecimal(await cdfLookup.cdf(toDecimalStr(6))), '1');
      });
    });

    context('when cdf(-6)', () => {
      it('should be 0', async () => {
        assert.equal(strFromDecimal(await cdfLookup.cdf(toDecimalStr(-6))), '0');
      });
    });

    context('when cdf(4.123)', () => {
      it('should be 0.99998512324946519', async () => {
        assert.equal(strFromDecimal(await cdfLookup.cdf(toDecimalStr(4.123))), '0.99998512324946519');
      });
    });

    context('when cdf(-4.123)', () => {
      it('should be 0.00001487675053481', async () => {
        assert.equal(strFromDecimal(await cdfLookup.cdf(toDecimalStr(-4.123))), '0.00001487675053481');
      });
    });

    context('when cdf(3.999)', () => {
      it('should be cdf', async () => {
        assert.equal(strFromDecimal(await cdfLookup.cdf(toDecimalStr(3.999))), '0.999968192217587251');
      });
    });

    context('when cdf(-3.999)', () => {
      it('should be 0.000031807782412749', async () => {
        assert.equal(strFromDecimal(await cdfLookup.cdf(toDecimalStr(-3.999))), '0.000031807782412749');
      });
    });

    context('when cdf(3.99)', () => {
      it('should be 0.999966963352370304', async () => {
        assert.equal(strFromDecimal(await cdfLookup.cdf(toDecimalStr(3.99))), '0.999966963352370304');
      });
    });

    context('when cdf(-3.99)', () => {
      it('should be 0.000033036647629696', async () => {
        assert.equal(strFromDecimal(await cdfLookup.cdf(toDecimalStr(-3.99))), '0.000033036647629696');
      });
    });
  });
});
