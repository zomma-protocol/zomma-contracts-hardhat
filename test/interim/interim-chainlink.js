const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal } = require('../support/helper');
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");

let InterimChainlink, accounts;
describe('InterimChainlink', () => {
  let owner, otherAccount;
  let chainlink;

  before(async () => {
    [InterimChainlink] = await getContractFactories('InterimChainlink');
    accounts = await ethers.getSigners();
    [owner, otherAccount] = accounts;
    chainlink = await InterimChainlink.deploy(8);
  });

  describe('#constructor', () => {
    it('should be decimals 8', async () => {
      assert.equal(await chainlink.decimals(), 8);
    });
  });

  describe('#setOutdatedPeriod', () => {
    context('when owner', () => {
      before(async () => {
        await chainlink.setOutdatedPeriod(3601);
      });

      after(async () => {
        await chainlink.setOutdatedPeriod(3600);
      })

      it('should be 3601', async () => {
        assert.equal(await chainlink.outdatedPeriod(), 3601);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(chainlink.connect(otherAccount).setOutdatedPeriod(3602), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#submit', () => {
    let updatedAt;

    before(async () => {
      updatedAt = Math.floor(Date.now() / 1000);
    });

    context('when owner', () => {
      context('when roundId is greater than lastest', () => {
        context('when addToHistory is false', () => {

          before(async () => {
            await chainlink.submit(toDecimalStr(1000, 8), 100, updatedAt, false);
          });

          it('should be latestAnswer 1000', async () => {
            assert.equal(strFromDecimal(await chainlink.latestAnswer(), 8), '1000');
          });

          it('should be roundId 100', async () => {
            assert.equal(await chainlink.roundId(), 100);
          });

          it('should be getAnswer 0', async () => {
            assert.equal(strFromDecimal(await chainlink.getAnswer(100), 8), '0');
          });

          it('should be getTimestamp 0', async () => {
            assert.equal(await chainlink.getTimestamp(100), 0);
          });
        });

        context('when addToHistory is true', () => {
          before(async () => {
            await chainlink.submit(toDecimalStr(1001, 8), 101, updatedAt + 60, true);
          });

          it('should be latestAnswer 1001', async () => {
            assert.equal(strFromDecimal(await chainlink.latestAnswer(), 8), '1001');
          });

          it('should be roundId 101', async () => {
            assert.equal(await chainlink.roundId(), 101);
          });

          it('should be getAnswer 1001', async () => {
            assert.equal(strFromDecimal(await chainlink.getAnswer(101), 8), '1001');
          });

          it('should be getTimestamp updatedAt + 60', async () => {
            assert.equal(await chainlink.getTimestamp(101), updatedAt + 60);
          });
        });
      });

      context('when roundId is not greater than lastest', () => {
        context('when addToHistory is false', () => {
          before(async () => {
            await chainlink.submit(toDecimalStr(999, 8), 99, updatedAt - 60, false);
          });

          it('should be latestAnswer 1001', async () => {
            assert.equal(strFromDecimal(await chainlink.latestAnswer(), 8), '1001');
          });

          it('should be roundId 101', async () => {
            assert.equal(await chainlink.roundId(), 101);
          });

          it('should be getAnswer 0', async () => {
            assert.equal(strFromDecimal(await chainlink.getAnswer(99), 8), '0');
          });

          it('should be getTimestamp 0', async () => {
            assert.equal(await chainlink.getTimestamp(99), 0);
          });
        });

        context('when addToHistory is true', () => {
          before(async () => {
            await chainlink.submit(toDecimalStr(998, 8), 98, updatedAt - 120, true);
          });

          it('should be latestAnswer 1001', async () => {
            assert.equal(strFromDecimal(await chainlink.latestAnswer(), 8), '1001');
          });

          it('should be roundId 101', async () => {
            assert.equal(await chainlink.roundId(), 101);
          });

          it('should be getAnswer 998', async () => {
            assert.equal(strFromDecimal(await chainlink.getAnswer(98), 8), '998');
          });

          it('should be getTimestamp updatedAt - 120', async () => {
            assert.equal(await chainlink.getTimestamp(98), updatedAt - 120);
          });
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(chainlink.connect(otherAccount).submit(toDecimalStr(1002, 8), 102, updatedAt, false), 'Ownable: caller is not the owner');
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
    })

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(chainlink.connect(otherAccount).setHistory(toDecimalStr(100, 8), 2, updatedAt + 60), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#latestAnswer', () => {
    async function deployFixture(timeToIncrease) {
      const chainlink = await InterimChainlink.deploy(8);
      chainlink.submit(toDecimalStr(1010, 8), 110, await time.latest(), false);
      await time.increase(timeToIncrease);
      return { chainlink };
    }

    context('when outdated', () => {
      let chainlink;

      before(async () => {
        ({chainlink} = await deployFixture(3600));
      });

      it('should revert with "outdated"', async () => {
        await expectRevert(chainlink.latestAnswer(), 'outdated');
      });
    });

    context('when not outdated', () => {
      let chainlink;

      before(async () => {
        ({chainlink} = await deployFixture(3598));
      });

      context('when normal time', () => {
        it('should be latestAnswer 1010', async () => {
          assert.equal(strFromDecimal(await chainlink.latestAnswer(), 8), '1010');
        });
      });

      context('when future time', () => {
        before(async () => {
          chainlink.submit(toDecimalStr(1020, 8), 111, await time.latest() + 60, false);
        });

        it('should be latestAnswer 1020', async () => {
          assert.equal(strFromDecimal(await chainlink.latestAnswer(), 8), '1020');
        });
      });
    });
  });
});
