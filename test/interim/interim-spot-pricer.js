const assert = require('assert');
const { expect } = require('chai');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal } = require('../support/helper');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');

let Vault, SpotPricer, Chainlink, ChainlinkProxy, accounts;
describe('InterimSpotPricer', () => {
  let spotPricer, chainlink, chainlinkProxy;

  before(async () => {
    [Vault, SpotPricer, Chainlink, ChainlinkProxy] = await getContractFactories('TestVault', 'InterimSpotPricer', 'TestChainlink', 'TestChainlinkProxy');
    accounts = await ethers.getSigners();
    spotPricer = await SpotPricer.deploy();
    chainlink = await Chainlink.deploy(8);
    chainlinkProxy = await ChainlinkProxy.deploy();

    await chainlink.setDecimals(8);
    await chainlinkProxy.setChainlink(chainlink.address);
    await spotPricer.initialize(chainlinkProxy.address);
  });

  describe('#migrate', () => {
    let newChainlink, newChainlinkProxy;

    before(async () => {
      newChainlink = await Chainlink.deploy(8);
      newChainlinkProxy = await ChainlinkProxy.deploy();
      await newChainlinkProxy.setChainlink(newChainlink.address);
      await newChainlink.submit(toDecimalStr('1100', 8));
    });

    context('when owner', () => {
      context('when not migrated', () => {
        context('when unchanged', () => {
          it('should revert with "unchanged"', async () => {
            await expectRevert(spotPricer.migrate(chainlinkProxy.address), 'unchanged');
          });
        });

        context('when changed', () => {
          context('when not chainlinkProxy', () => {
            it('should revert without reason ', async () => {
              await expect(spotPricer.migrate(accounts[1].address)).to.be.revertedWithoutReason();
            });
          });

          context('when chainlinkProxy', () => {
            context('when no round', () => {
              let emptyChainlink;

              before(async () => {
                emptyChainlink = await Chainlink.deploy(8);
              });

              it('should revert with "unchanged"', async () => {
                await expectRevert(spotPricer.migrate(emptyChainlink.address), 'incorrect interface');
              });
            });

            context('when round exists', () => {
              before(async () => {
                await spotPricer.migrate(newChainlink.address);
              });

              it('should be migrated', async () => {
                assert.equal(await spotPricer.migrated(), true);
              });

              it('should be new oracle', async () => {
                assert.equal(await spotPricer.oracle(), newChainlink.address);
              });

            });
          });
        });
      });

      context('when migrated', () => {
        it('should revert with "already migrated"', async () => {
          await expectRevert(spotPricer.migrate(newChainlink.address), 'already migrated');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(spotPricer.connect(accounts[1]).migrate(chainlinkProxy.address), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#settle', () => {
    context('when migrated', () => {
      let spotPricer, vault;

      let initExpiry = 1674201600; // 2023-01-20T08:00:00Z
      const setupExpiry = async () => {
        expiry = initExpiry;
        initExpiry += 86400;
        await chainlink.setNow(expiry - 60);
        await chainlink.submit(toDecimalStr('1100', 8));
        roundId = (await chainlink.latestRound());

        await chainlink.setNow(expiry);
        await chainlink.submit(toDecimalStr('1200', 8));
        roundId2 = (await chainlink.latestRound());
        return { roundId, roundId2, expiry };
      };

      before(async () => {
        const [TestInterimSpotPricer] = await getContractFactories('TestInterimSpotPricer');
        vault = await Vault.deploy();
        spotPricer = await TestInterimSpotPricer.deploy();
        await spotPricer.initialize(ZERO_ADDRESS);
        await chainlink.setNow(initExpiry - 120);
        await chainlink.submit(toDecimalStr('1100', 8));
        await spotPricer.migrate(chainlinkProxy.address);
        await spotPricer.setVault(vault.address);
      });

      context('when not settled ', () => {
        context('when not expired ', () => {
          let expiry, now, roundId2;

          before(async () => {
            ({ expiry, roundId2 } = await setupExpiry());
            now = expiry - 1;
            await chainlink.setNow(now);
            await vault.setTimestamp(now);
          });

          it('should revert with "invalid roundId"', async () => {
            await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId2), 'invalid roundId');
          });
        });

        context('when expired ', () => {
          context('when next round id does not exist', () => {
            let expiry, now;

            before(async () => {
              ({ expiry, roundId2 } = await setupExpiry());
              now = expiry + 1;
              await chainlink.setNow(now);
              await vault.setTimestamp(now);
            });

            it('should revert with "invalid roundId"', async () => {
              await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId2), 'invalid roundId');
            });
          });

          context('when next round id over expiry', () => {
            let expiry, now, roundId2;

            before(async () => {
              ({ expiry, roundId2 } = await setupExpiry());
              now = expiry + 1;
              await chainlink.setNow(now);
              await vault.setTimestamp(now);
              await chainlink.submit(toDecimalStr('1300', 8));
              await spotPricer.connect(accounts[1]).settle(expiry, roundId2);
            });

            it('should get 1200', async () => {
              assert.equal(strFromDecimal(await spotPricer.settledPrices(expiry)), '1200');
            });
          });

          context('when next round id not over expiry', () => {
          let expiry, now, roundId;

            before(async () => {
              ({ expiry, roundId } = await setupExpiry());
              now = expiry + 1;
              await chainlink.setNow(now);
              await vault.setTimestamp(now);
            });

            it('should revert with "invalid roundId"', async () => {
              await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId), 'invalid roundId');
            });
          });

          context('when round id expired', () => {
            let expiry, now, roundId3;

            before(async () => {
              ({ expiry } = await setupExpiry());
              now = expiry + 1;
              await chainlink.setNow(now);
              await vault.setTimestamp(now);
              await chainlink.submit(toDecimalStr('1300', 8));
              roundId3 = (await chainlink.latestRound());
            });

            it('should revert with "invalid roundId"', async () => {
              await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId3), 'invalid roundId');
            });
          });

          context('when round id does not exist', () => {
            let expiry, now, roundId;

            before(async () => {
              ({ expiry, roundId } = await setupExpiry());
              await chainlink.setNow(0);
              await chainlink.submit(toDecimalStr('0', 8));
              now = expiry + 1;
              await chainlink.setNow(now);
              await vault.setTimestamp(now);
            });

            it('should revert with "invalid roundId"', async () => {
              await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId + 1), 'invalid roundId');
            });
          });
        });
      });

      context('when settled ', () => {
        let expiry, now, roundId;

        before(async () => {
          ({ expiry, roundId, roundId2 } = await setupExpiry());
          now = expiry + 1;
          await chainlink.setNow(now);
          await vault.setTimestamp(now);
          await chainlink.submit(toDecimalStr('1300', 8));
          await spotPricer.connect(accounts[1]).settle(expiry, roundId2);
        });

        it('should revert with "settled"', async () => {
          await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId), 'settled');
        });
      });
    });

    context('when not migrated', () => {
      let spotPricer, vault;

      let initExpiry = 1674201600; // 2023-01-20T08:00:00Z
      const setupExpiry = async () => {
        expiry = initExpiry;
        initExpiry += 86400;
        await chainlink.setNow(expiry - 60);
        await chainlink.submit(toDecimalStr('1100', 8));
        roundId = (await chainlink.latestRound());

        await chainlink.setNow(expiry);
        await chainlink.submit(toDecimalStr('1200', 8));
        roundId2 = (await chainlink.latestRound());
        return { roundId, roundId2, expiry };
      };

      before(async () => {
        const [TestInterimSpotPricer] = await getContractFactories('TestInterimSpotPricer');
        vault = await Vault.deploy();
        spotPricer = await TestInterimSpotPricer.deploy();
        await spotPricer.initialize(chainlinkProxy.address);
        await spotPricer.setVault(vault.address);
      });

      context('when not settled ', () => {
        context('when not expired ', () => {
          let expiry, now, roundId2;

          before(async () => {
            ({ expiry, roundId2 } = await setupExpiry());
            now = expiry - 1;
            await chainlink.setNow(now);
            await vault.setTimestamp(now);
          });

          it('should revert with "invalid roundId"', async () => {
            await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId2), 'invalid roundId');
          });
        });

        context('when expired ', () => {
          context('when next round id does not exist', () => {
            let expiry, now;

            before(async () => {
              ({ expiry, roundId2 } = await setupExpiry());
              now = expiry + 1;
              await chainlink.setNow(now);
              await vault.setTimestamp(now);
            });

            it('should revert with "invalid roundId"', async () => {
              await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId2), 'invalid roundId');
            });
          });

          context('when next round id over expiry', () => {
            let expiry, now, roundId2;

            before(async () => {
              ({ expiry, roundId2 } = await setupExpiry());
              now = expiry + 1;
              await chainlink.setNow(now);
              await vault.setTimestamp(now);
              await chainlink.submit(toDecimalStr('1300', 8));
              await spotPricer.connect(accounts[1]).settle(expiry, roundId2);
            });

            it('should get 1200', async () => {
              assert.equal(strFromDecimal(await spotPricer.settledPrices(expiry)), '1200');
            });
          });

          context('when next round id not over expiry', () => {
          let expiry, now, roundId;

            before(async () => {
              ({ expiry, roundId } = await setupExpiry());
              now = expiry + 1;
              await chainlink.setNow(now);
              await vault.setTimestamp(now);
            });

            it('should revert with "invalid roundId"', async () => {
              await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId), 'invalid roundId');
            });
          });

          context('when round id expired', () => {
            let expiry, now, roundId3;

            before(async () => {
              ({ expiry } = await setupExpiry());
              now = expiry + 1;
              await chainlink.setNow(now);
              await vault.setTimestamp(now);
              await chainlink.submit(toDecimalStr('1300', 8));
              roundId3 = (await chainlink.latestRound());
            });

            it('should revert with "invalid roundId"', async () => {
              await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId3), 'invalid roundId');
            });
          });

          context('when round id does not exist', () => {
            let expiry, now, roundId;

            before(async () => {
              ({ expiry, roundId } = await setupExpiry());
              await chainlink.setNow(0);
              await chainlink.submit(toDecimalStr('0', 8));
              now = expiry + 1;
              await chainlink.setNow(now);
              await vault.setTimestamp(now);
            });

            it('should revert with "invalid roundId"', async () => {
              await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId + 1), 'invalid roundId');
            });
          });
        });
      });

      context('when settled ', () => {
        let expiry, now, roundId;

        before(async () => {
          ({ expiry, roundId, roundId2 } = await setupExpiry());
          now = expiry + 1;
          await chainlink.setNow(now);
          await vault.setTimestamp(now);
          await chainlink.submit(toDecimalStr('1300', 8));
          await spotPricer.connect(accounts[1]).settle(expiry, roundId2);
        });

        it('should revert with "settled"', async () => {
          await expectRevert(spotPricer.connect(accounts[1]).settle(expiry, roundId), 'settled');
        });
      });
    });
  });
});
