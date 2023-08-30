const assert = require('assert');
const { getContractFactories, strFromDecimal } = require('../support/helper');

let SignedSafeDecimalMath;
describe('SignedSafeDecimalMath', () => {
  let signedSafeDecimalMath;

  before(async () => {
    [SignedSafeDecimalMath] = await getContractFactories('TestSignedSafeDecimalMath');
    signedSafeDecimalMath =await SignedSafeDecimalMath.deploy();
  });

  describe('#decimalDivRound', () => {
    describe('when -0.000000000000000005 / 10', () => {
      it('should 0', async () => {
        assert.equal(strFromDecimal(await signedSafeDecimalMath.decimalDivRound('-2', '3')), '-0.666666666666666667');
      });
    });
  });
});
