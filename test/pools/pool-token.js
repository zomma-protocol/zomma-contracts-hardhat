const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal } = require('../support/helper');

let PoolToken, accounts;
describe('PoolToken', async () => {
  let poolToken;

  before(async () => {
    [PoolToken] = await getContractFactories('PoolToken');
    accounts = await ethers.getSigners();
    poolToken = await PoolToken.deploy();
    await poolToken.initialize(accounts[0].address, 'NAME', 'SYMBOL');
  });

  describe('#initialize', () => {
    context('when initialize once', () => {
      it('should pass', async () => {
        assert.equal(await poolToken.initialized(), true);
        assert.equal(await poolToken.name(), 'NAME');
        assert.equal(await poolToken.symbol(), 'SYMBOL');
      });
    });

    context('when initialize twice', () => {
      it('should revert with "already initialized"', async () => {
        await expectRevert(poolToken.initialize(accounts[1].address, 'NAME2', 'SYMBOL2'), 'already initialized');
      });
    });
  });

  describe('#mint', () => {
    context('when pool', () => {
      before(async () => {
        await poolToken.mint(accounts[1].address, toDecimalStr(1000));
      });

      it('should mint 1000', async () => {
        assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[1].address)), '1000');
      });
    });

    context('when not pool', () => {
      it('should revert with "only pool"', async () => {
        await expectRevert(poolToken.connect(accounts[1]).mint(accounts[1].address, toDecimalStr(1000)), 'only pool');
      });
    });
  });

  describe('#burn', () => {
    before(async () => {
      await poolToken.mint(accounts[2].address, toDecimalStr(1000));
    });

    context('when pool', () => {
      before(async () => {
        await poolToken.burn(accounts[2].address, toDecimalStr(100));
      });

      it('should burn 100', async () => {
        assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '900');
      });
    });

    context('when not pool', () => {
      it('should revert with "only pool"', async () => {
        await expectRevert(poolToken.connect(accounts[1]).burn(accounts[2].address, toDecimalStr(100)), 'only pool');
      });
    });
  });
});
