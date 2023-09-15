const assert = require('assert');
const { getContractFactories, expectRevert, expectRevertCustom } = require('./support/helper');

let SignatureValidator, accounts;
describe('SignatureValidator', () => {
  let signatureValidator, owner;

  before(async () => {
    [SignatureValidator] = await getContractFactories('TestSignatureValidator');
    accounts = await ethers.getSigners();
    [owner] = accounts;
    signatureValidator = await SignatureValidator.deploy();
    await signatureValidator.initialize();
  });

  describe('#initialize', () => {
    context('when initialize once', () => {
      it('should pass', async () => {
        assert.equal(await signatureValidator.owner(), owner.address);
      });
    });

    context('when initialize twice', () => {
      it('should revert with "Initializable: contract is already initialized"', async () => {
        await expectRevert(signatureValidator.initialize(), 'Initializable: contract is already initialized');
      });
    });
  });

  describe('#cancelNonceBefore', () => {
    context('when nonce 10', () => {
      before(async () => {
        await signatureValidator.cancelNonceBefore(10);
      });

      it('should be 10', async () => {
        assert.equal(await signatureValidator.nonces(owner.address), 10);
      });
    });

    context('when nonce 0', () => {
      it('should revert with InvalidNonce', async () => {
        await expectRevertCustom(signatureValidator.cancelNonceBefore(0), signatureValidator, 'InvalidNonce');
      });
    });
  });
});
