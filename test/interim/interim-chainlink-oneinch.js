const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal } = require('../support/helper');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');

let InterimChainlinkOneinch, Oneinch, accounts;
describe('InterimChainlinkOneinch', () => {
  let owner, otherAccount;
  let chainlink, oneinch;

  before(async () => {
    [InterimChainlinkOneinch, Oneinch] = await getContractFactories('InterimChainlinkOneinch', 'TestOneinch');
    accounts = await ethers.getSigners();
    [owner, otherAccount] = accounts;
    oneinch = await Oneinch.deploy();
    chainlink = await InterimChainlinkOneinch.deploy(8);
    await chainlink.setAddresses(100, oneinch.address, ZERO_ADDRESS, ZERO_ADDRESS);
  });

  describe('#constructor', () => {
    it('should be decimals 8', async () => {
      assert.equal(await chainlink.decimals(), 8);
      assert.equal(await chainlink.offset(), 100);
      assert.equal(await chainlink.oracle(), oneinch.address);
    });
  });

  describe('#latestAnswer', () => {
    before(async () => {
      await oneinch.setRate(toDecimalStr(1010, 6));
    });

    it('should be latestAnswer 1010', async () => {
      assert.equal(strFromDecimal(await chainlink.latestAnswer(), 8), '1010');
    });
  });

  describe('#setAddresses', () => {
    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(chainlink.connect(otherAccount).setAddresses(100, otherAccount.address, ZERO_ADDRESS, ZERO_ADDRESS), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setHistory', () => {
    const updatedAt = 1674201600; // 2023-01-20T08:00:00Z

    context('when owner', () => {
      context('when first time', () => {
        before(async () => {
          await chainlink.setHistory(toDecimalStr(90, 8), 1, updatedAt);
        });

        it('should be getAnswer 90', async () => {
          assert.equal(strFromDecimal(await chainlink.getAnswer(1), 8), '90');
        });

        it('should be getTimestamp 1674201600', async () => {
          assert.equal(await chainlink.getTimestamp(1), 1674201600);
        });
      });

      context('when second time', () => {
        it('should revert with "submitted"', async () => {
          await expectRevert(chainlink.setHistory(toDecimalStr(90, 8), 1, updatedAt), 'submitted');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(chainlink.connect(otherAccount).setHistory(toDecimalStr(100, 8), 2, updatedAt + 60), 'Ownable: caller is not the owner');
      });
    });
  });
});
