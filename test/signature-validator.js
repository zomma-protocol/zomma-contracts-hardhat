const assert = require('assert');
const { getContractFactories, expectRevert, expectRevertCustom } = require('./support/helper');

let SignatureValidator, accounts;
describe('SignatureValidator', () => {
  let signatureValidator, owner;

  before(async () => {
    [SignatureValidator] = await getContractFactories('SignatureValidator');
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

  describe('#recoverAndUseNonce', () => {
    context('when sender does not have role', () => {
      it('should revert with "AccessControl: account"', async () => {
        await expectRevert(signatureValidator.connect(accounts[1]).recoverAndUseNonce('0x00', 0, 0, '0x0000000000000000000000000000000000000000000000000000000000000000', '0x0000000000000000000000000000000000000000000000000000000000000000'), /AccessControl: account/);
      });
    });
  });
});
