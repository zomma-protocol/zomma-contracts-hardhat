const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal } = require('../support/helper');
const { time } = require("@nomicfoundation/hardhat-network-helpers");

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
      context('when latestRound is greater than lastest', () => {
        context('when addToHistory is false', () => {
          let roundData;

          before(async () => {
            await chainlink.submit(toDecimalStr(1000, 8), 100, updatedAt, false);
            roundData = await chainlink.getRoundData(100);
          });

          it('should be latestRoundData answer 1000', async () => {
            const latestRoundData = await chainlink.latestRoundData();
            assert.equal(strFromDecimal(latestRoundData.answer, 8), '1000');
          });

          it('should be latestRound 100', async () => {
            assert.equal(await chainlink.latestRound(), 100);
          });

          it('should be getRoundData answer 0', async () => {
            assert.equal(strFromDecimal(roundData.answer, 8), '0');
          });

          it('should be getRoundData startedAt 0', async () => {
            assert.equal(roundData.startedAt, 0);
          });
        });

        context('when addToHistory is true', () => {
          let roundData;

          before(async () => {
            await chainlink.submit(toDecimalStr(1001, 8), 101, updatedAt + 60, true);
            roundData = await chainlink.getRoundData(101);
          });

          it('should be latestRoundData answer 1001', async () => {
            const latestRoundData = await chainlink.latestRoundData();
            assert.equal(strFromDecimal(latestRoundData.answer, 8), '1001');
          });

          it('should be latestRound 101', async () => {
            assert.equal(await chainlink.latestRound(), 101);
          });

          it('should be getRoundData answer 1001', async () => {
            assert.equal(strFromDecimal(roundData.answer, 8), '1001');
          });

          it('should be getRoundData startedAt updatedAt + 60', async () => {
            assert.equal(roundData.startedAt, updatedAt + 60);
          });
        });
      });

      context('when latestRound is not greater than lastest', () => {
        context('when addToHistory is false', () => {
          let roundData;

          before(async () => {
            await chainlink.submit(toDecimalStr(999, 8), 99, updatedAt - 60, false);
            roundData = await chainlink.getRoundData(99);
          });

          it('should be latestRoundData answer 1001', async () => {
            const latestRoundData = await chainlink.latestRoundData();
            assert.equal(strFromDecimal(latestRoundData.answer, 8), '1001');
          });

          it('should be latestRound 101', async () => {
            assert.equal(await chainlink.latestRound(), 101);
          });

          it('should be getRoundData answer 0', async () => {
            assert.equal(strFromDecimal(roundData.answer, 8), '0');
          });

          it('should be getRoundData startedAt 0', async () => {
            assert.equal(roundData.startedAt, 0);
          });
        });

        context('when addToHistory is true', () => {
          let roundData;

          before(async () => {
            await chainlink.submit(toDecimalStr(998, 8), 98, updatedAt - 120, true);
            roundData = await chainlink.getRoundData(98);
          });

          it('should be latestRoundData answer 1001', async () => {
            const latestRoundData = await chainlink.latestRoundData();
            assert.equal(strFromDecimal(latestRoundData.answer, 8), '1001');
          });

          it('should be latestRound 101', async () => {
            assert.equal(await chainlink.latestRound(), 101);
          });

          it('should be getRoundData answer 998', async () => {
            assert.equal(strFromDecimal(roundData.answer, 8), '998');
          });

          it('should be getRoundData startedAt updatedAt - 120', async () => {
            assert.equal(roundData.startedAt, updatedAt - 120);
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

  describe('#latestRoundData', () => {
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
        await expectRevert(chainlink.latestRoundData(), 'outdated');
      });
    });

    context('when not outdated', () => {
      let chainlink;

      before(async () => {
        ({chainlink} = await deployFixture(3598));
      });

      context('when normal time', () => {
        it('should be latestRoundData answer 1010', async () => {
          const latestRoundData = await chainlink.latestRoundData();
          assert.equal(strFromDecimal(latestRoundData.answer, 8), '1010');
        });
      });

      context('when future time', () => {
        before(async () => {
          chainlink.submit(toDecimalStr(1020, 8), 111, await time.latest() + 60, false);
        });

        it('should be latestRoundData answer 1020', async () => {
          const latestRoundData = await chainlink.latestRoundData();
          assert.equal(strFromDecimal(latestRoundData.answer, 8), '1020');
        });
      });
    });
  });
});
