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

  describe('#latestRoundData', () => {
    before(async () => {
      await oneinch.setRate(toDecimalStr(1010, 6));
    });

    it('should be latestRoundData answer 1010', async () => {
      const latestRoundData = await chainlink.latestRoundData();
      assert.equal(strFromDecimal(latestRoundData.answer, 8), '1010');
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
        let roundData;

        before(async () => {
          await chainlink.setHistory(toDecimalStr(90, 8), 1, updatedAt);
          roundData = await chainlink.getRoundData(1);
        });

        it('should be getRoundData answer 90', async () => {
          assert.equal(strFromDecimal(roundData.answer, 8), '90');
        });

        it('should be getRoundData startedAt 1674201600', async () => {
          assert.equal(roundData.startedAt, 1674201600);
        });

        it('should be latestRound 0', async () => {
          assert.equal(await chainlink.latestRound(), 0);
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
