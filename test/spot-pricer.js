const assert = require('assert');
const { getContractFactories, expectRevertCustom, toDecimalStr, strFromDecimal, INT_MAX } = require('./support/helper');

let Vault, SpotPricer, Chainlink, ChainlinkProxy, accounts;
describe('SpotPricer', () => {
  let spotPricer, chainlink, chainlinkProxy;

  before(async () => {
    [Vault, SpotPricer, Chainlink, ChainlinkProxy] = await getContractFactories('TestVault', 'SpotPricer', 'TestChainlink', 'TestChainlinkProxy');
    accounts = await ethers.getSigners();
    spotPricer = await SpotPricer.deploy();
    chainlink = await Chainlink.deploy(8);
    chainlinkProxy = await ChainlinkProxy.deploy();

    await chainlink.setDecimals(8);
    await chainlinkProxy.setChainlink(chainlink.address);
    await spotPricer.initialize(chainlinkProxy.address);
  });

  describe('#initialize', () => {
    context('when initialize once', () => {
      it('should pass', async () => {
        assert.equal(await spotPricer.initialized(), true);
        assert.equal(await spotPricer.oracle(), chainlinkProxy.address);
      });
    });

    context('when initialize twice', () => {
      it('should revert with AlreadyInitialized', async () => {
        await expectRevertCustom(spotPricer.initialize(accounts[1].address), SpotPricer, 'AlreadyInitialized');
      });
    });
  });

  describe('#getPrice', () => {
    context('when chainlink decimals 8 ', () => {
      context('when chainlink 1200.12345678', () => {
        const now = 1673596800; // 2023-01-13T08:00:00Z
        let spotPricer, vault;

        before(async () => {
          const [TestSpotPricer] = await getContractFactories('TestSpotPricer');
          vault = await Vault.deploy();
          spotPricer = await TestSpotPricer.deploy();
          await spotPricer.initialize(chainlinkProxy.address);
          await spotPricer.setVault(vault.address);
          await vault.setTimestamp(now + 3600);
          await chainlink.setNow(now);
          await chainlink.submit(toDecimalStr('1200.12345678', 8));
          await chainlink.setNow(0);
        });

        context('when maxPrice is 1200', () => {
          before(async () => {
            await spotPricer.setMaxPrice(toDecimalStr('1200'));
          });

          after(async () => {
            await spotPricer.setMaxPrice(INT_MAX);
          });

          it('should revert with AboveMaxPrice', async () => {
            await expectRevertCustom(spotPricer.getPrice(), SpotPricer, 'AboveMaxPrice');
          });
        });

        context('when minPrice is 1300', () => {
          before(async () => {
            await spotPricer.setMinPrice(toDecimalStr('1300'));
          });

          after(async () => {
            await spotPricer.setMinPrice(1);
          });

          it('should revert with BelowMinPrice', async () => {
            await expectRevertCustom(spotPricer.getPrice(), SpotPricer, 'BelowMinPrice');
          });
        });

        context('when after 1 hour', () => {
          before(async () => {
            await vault.setTimestamp(now + 3601);
          });

          after(async () => {
            await vault.setTimestamp(now);
          });

          it('should revert with StalePrice', async () => {
            await expectRevertCustom(spotPricer.getPrice(), SpotPricer, 'StalePrice');
          });
        });

        context('when normal', () => {
          it('should get 1200.12345678', async () => {
            assert.equal(strFromDecimal(await spotPricer.getPrice()), '1200.12345678');
          });
        });
      });
    });

    context('when chainlink decimals 19 ', () => {
      context('when chainlink 1200.1234567891234567899', () => {
        before(async () => {
          await chainlink.setDecimals(19);
          await chainlink.submit(toDecimalStr('1200.1234567891234567899', 19));
        });

        after(async () => {
          await chainlink.setDecimals(8);
        });

        it('should get 1200.123456789123456789', async () => {
          assert.equal(strFromDecimal(await spotPricer.getPrice()), '1200.123456789123456789');
        });
      });
    });
  });

  describe('#settle', () => {
    let spotPricer, vault;

    let initExpiry = 1674201600; // 2023-01-20T08:00:00Z
    const setupExpiry = async () => {
      expiry = initExpiry;
      initExpiry += 86400;
      await chainlink.setNow(expiry - 60);
      await chainlink.submit(toDecimalStr('1100', 8));
      const roundId = (await chainlink.latestRound());

      await chainlink.setNow(expiry);
      await chainlink.submit(toDecimalStr('1200', 8));
      const roundId2 = (await chainlink.latestRound());
      return { roundId, roundId2, expiry };
    };

    before(async () => {
      const [TestSpotPricer] = await getContractFactories('TestSpotPricer');
      vault = await Vault.deploy();
      spotPricer = await TestSpotPricer.deploy();
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

        it('should revert with InvalidRoundId', async () => {
          await expectRevertCustom(spotPricer.connect(accounts[1]).settle(expiry, roundId2), SpotPricer, 'InvalidRoundId');
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

          it('should revert with InvalidRoundId', async () => {
            await expectRevertCustom(spotPricer.connect(accounts[1]).settle(expiry, roundId2), SpotPricer, 'InvalidRoundId');
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
          });

          context('when maxPrice is 1100', () => {
            before(async () => {
              await spotPricer.setMaxPrice(toDecimalStr('1100'));
            });

            after(async () => {
              await spotPricer.setMaxPrice(INT_MAX);
            });

            it('should revert with AboveMaxPrice', async () => {
              await expectRevertCustom(spotPricer.connect(accounts[1]).settle(expiry, roundId2), SpotPricer, 'AboveMaxPrice');
            });
          });

          context('when minPrice is 1300', () => {
            before(async () => {
              await spotPricer.setMinPrice(toDecimalStr('1300'));
            });

            after(async () => {
              await spotPricer.setMinPrice(1);
            });

            it('should revert with BelowMinPrice', async () => {
              await expectRevertCustom(spotPricer.connect(accounts[1]).settle(expiry, roundId2), SpotPricer, 'BelowMinPrice');
            });
          });

          context('when normal', () => {
            before(async () => {
              await spotPricer.connect(accounts[1]).settle(expiry, roundId2);
            });

            it('should get 1200', async () => {
              assert.equal(strFromDecimal(await spotPricer.settledPrices(expiry)), '1200');
            });
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

          it('should revert with InvalidRoundId', async () => {
            await expectRevertCustom(spotPricer.connect(accounts[1]).settle(expiry, roundId), SpotPricer, 'InvalidRoundId');
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

          it('should revert with InvalidRoundId', async () => {
            await expectRevertCustom(spotPricer.connect(accounts[1]).settle(expiry, roundId3), SpotPricer, 'InvalidRoundId');
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

          it('should revert with InvalidRoundId', async () => {
            await expectRevertCustom(spotPricer.connect(accounts[1]).settle(expiry, roundId + 1), SpotPricer, 'InvalidRoundId');
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

      it('should revert with Settled', async () => {
        await expectRevertCustom(spotPricer.connect(accounts[1]).settle(expiry, roundId2), SpotPricer, 'Settled');
      });
    });
  });
});
