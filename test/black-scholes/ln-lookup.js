const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal } = require('../support/helper');
const ln = require('../../scripts/ln');

let LnLookup;
describe('LnLookup', () => {
  let lnLookup;

  before(async () => {
    [LnLookup] = await getContractFactories('LnLookup');
    lnLookup = await LnLookup.deploy();
    await lnLookup.setLn(ln.keys, ln.values);
    await lnLookup.freezeLn();
  });

  describe('#freezeLn', () => {
    it('should be frozenLn true', async () => {
      assert.equal(await lnLookup.frozenLn(), true);
    });
  });

  describe('#setLn', () => {
    context('when frozenLn false', () => {
      let lnLookup;

      before(async () => {
        lnLookup = await LnLookup.deploy();
      });

      context('when different length', () => {
        it('should revert with "incorrect length"', async () => {
          await expectRevert(lnLookup.setLn(ln.keys.slice(0, 1), ln.values.slice(0, 2)), 'incorrect length');
        });
      });

      context('when same length', () => {
        before(async () => {
          await lnLookup.setLn(ln.keys.slice(0, 1), ln.values.slice(0, 1));
        });

        it('should pass', async () => {
          assert.equal(await lnLookup.LN(ln.keys[0]), ln.values[0]);
        });
      });
    });

    context('when frozenLn true', () => {
      it('should revert with "frozen"', async () => {
        await expectRevert(lnLookup.setLn(ln.keys.slice(0, 1), ln.values.slice(0, 1)), 'frozen');
      });
    });
  });

  describe('#ln', () => {
    context('when ln(2.123)', () => {
      it('should be 0.754801444989539977', async () => {
        assert.equal(strFromDecimal(await lnLookup.ln(toDecimalStr(2.123))), '0.754801444989539977');
      });
    });

    context('when ln(1.999)', () => {
      it('should be 0.69264592637759088', async () => {
        assert.equal(strFromDecimal(await lnLookup.ln(toDecimalStr(1.999))), '0.69264592637759088');
      });
    });

    context('when ln(1.99)', () => {
      it('should be 0.688134638736401027', async () => {
        assert.equal(strFromDecimal(await lnLookup.ln(toDecimalStr(1.99))), '0.688134638736401027');
      });
    });

    context('when ln(0.009)', () => {
      it('should be -4.674484904044085852', async () => {
        assert.equal(strFromDecimal(await lnLookup.ln(toDecimalStr(0.009))), '-4.674484904044085852');
      });
    });
  });
});
