const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal } = require('../support/helper');

let InterimChainlink, InterimChainlinkProxy, accounts;
describe('InterimChainlinkProxy', () => {
  let owner, otherAccount;
  let chainlink, chainlinkProxy;
  const updatedAt = Math.floor(Date.now() / 1000);

  before(async () => {
    [InterimChainlink, InterimChainlinkProxy] = await getContractFactories('InterimChainlink', 'InterimChainlinkProxy');
    accounts = await ethers.getSigners();
    [owner, otherAccount] = accounts;
    chainlink = await InterimChainlink.deploy(8);
    chainlinkProxy = await InterimChainlinkProxy.deploy();
    await chainlinkProxy.setChainlink(chainlink.address);
    await chainlinkProxy.setPhaseId(2);
    await chainlink.submit(toDecimalStr(1000, 8), 100, updatedAt, true);
  });

  describe('#setChainlink', () => {
    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(chainlinkProxy.connect(otherAccount).setChainlink(otherAccount.address), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setPhaseId', () => {
    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(chainlinkProxy.connect(otherAccount).setPhaseId(3), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#aggregator', () => {
    it('should be chainlink', async () => {
      assert.equal(await chainlinkProxy.aggregator(), chainlink.address);
    });
  });

  describe('#phaseId', () => {
    it('should be 2', async () => {
      assert.equal(await chainlinkProxy.phaseId(), 2);
    });
  });

  describe('#decimals', () => {
    it('should be 8', async () => {
      assert.equal(await chainlinkProxy.decimals(), 8);
    });
  });

  describe('#latestAnswer', () => {
    it('should be 1000', async () => {
      assert.equal(await chainlinkProxy.latestAnswer(), toDecimalStr(1000, 8));
    });
  });

  describe('#getAnswer', () => {
    it('should be 1000', async () => {
      assert.equal(await chainlinkProxy.getAnswer(100), toDecimalStr(1000, 8));
    });
  });

  describe('#getTimestamp', () => {
    it('should be now', async () => {
      assert.equal(await chainlinkProxy.getTimestamp(100), updatedAt);
    });
  });

  describe('#phaseAggregators', () => {
    it('should be chainlink', async () => {
      assert.equal(await chainlinkProxy.phaseAggregators(1), chainlink.address);
    });
  });
});
