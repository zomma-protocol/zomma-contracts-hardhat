const assert = require('assert');
const { getContractFactories, expectRevertCustom, toDecimalStr, strFromDecimal, createOptionPricer, buildIv, mergeIv, watchBalance, addPool, mintAndDeposit, INT_MAX } = require('./support/helper');

let Vault, Config, TestERC20, SpotPricer, OptionMarket, accounts;
describe('Vault', () => {
  let stakeholderAccount, insuranceAccount, trader, trader2, pool, settler, liquidator, otherAccount, otherAccount2, pool2;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer, vault, config, usdc, optionMarket;

  const createVault = async (configAddress, optionMarketAddress) => {
    const vault = await Vault.deploy();
    await vault.initialize(configAddress, spotPricer.address, optionPricer.address, optionMarketAddress);
    return vault;
  }

  const setup = async (decimals = 6) => {
    const usdc = await TestERC20.deploy('USDC', 'USDC', decimals);
    const config = await Config.deploy();
    const optionMarket = await OptionMarket.deploy();
    const vault = await createVault(config.address, optionMarket.address);
    await config.initialize(vault.address, stakeholderAccount.address, insuranceAccount.address, usdc.address, decimals);
    await optionMarket.setVault(vault.address);
    await optionPricer.reinitialize(config.address, vault.address);
    return { vault, config, usdc, optionMarket };
  };

  const setupMarket = async (vault, optionMarket, ivs = [[expiry, strike, true, true, toDecimalStr(0.8), false], [expiry, strike, true, false, toDecimalStr(0.8), false]]) => {
    await vault.setTimestamp(now);
    await spotPricer.setPrice(toDecimalStr(1000));
    await optionMarket.setIv(mergeIv(ivs.map((iv) => buildIv(...iv))));
    await optionPricer.updateLookup(ivs.map((iv) => iv[0]));
  };

  before(async () => {
    [Vault, Config, TestERC20, SpotPricer, OptionMarket] = await getContractFactories('TestVault', 'Config', 'TestERC20', 'TestSpotPricer', 'TestOptionMarket');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader, trader2, pool, settler, liquidator, otherAccount, otherAccount2, pool2] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer();
    ({ vault, config, usdc, optionMarket } = await setup());
  });

  describe('#initialize', () => {
    context('when initialize once', () => {
      it('should pass', async () => {
        assert.equal(await vault.initialized(), true);
        assert.equal(await vault.config(), config.address);
        assert.equal(await vault.spotPricer(), spotPricer.address);
        assert.equal(await vault.optionPricer(), optionPricer.address);
      });
    });

    context('when initialize twice', () => {
      it('should revert with AlreadyInitialized', async () => {
        await expectRevertCustom(vault.initialize(trader.address, spotPricer.address, optionPricer.address, optionMarket.address), Vault, 'AlreadyInitialized');
      });
    });
  });

  describe('#deposit', () => {
    context('when quote decimal 6', () => {
      context('when deposit 1000', () => {
        let tvlChange;

        before(async () => {
          [tvlChange] = await watchBalance(usdc, [vault.address], async () => {
            await mintAndDeposit(vault, usdc, trader);
          });
        });

        it('should increase tvl 1000', async () => {
          assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), '1000');
          assert.equal(strFromDecimal(await usdc.balanceOf(trader.address), 6), '0');
          assert.equal(strFromDecimal(tvlChange, 6), '1000');
        });
      });

      context('when deposit 0', () => {
        it('should revert with ZeroAmount(0)', async () => {
          await expectRevertCustom(vault.connect(trader).deposit(toDecimalStr(0)), Vault, 'ZeroAmount').withArgs(0);
        });
      });

      context('when deposit 0.0000001', () => {
        it('should revert with ZeroAmount(0)', async () => {
          await expectRevertCustom(vault.connect(trader).deposit(toDecimalStr(0.0000001)), Vault, 'ZeroAmount').withArgs(0);
        });
      });

      context('when deposit 0.0000019', () => {
        let tvlChange;

        before(async () => {
          [tvlChange] = await watchBalance(usdc, [vault.address], async () => {
            await mintAndDeposit(vault, usdc, trader2, { amount: '0.0000019' });
          });
        });

        it('should increase tvl 0.000001', async () => {
          assert.equal(strFromDecimal(await vault.balanceOf(trader2.address)), '0.000001');
          assert.equal(strFromDecimal(await usdc.balanceOf(trader2.address), 6), '999.999999');
          assert.equal(strFromDecimal(tvlChange, 6), '0.000001');
        });
      });
    });

    context('when quote decimal 19', () => {
      let vault, config, usdc;

      before(async () => {
        ({ vault, config, usdc } = await setup(19));
        await usdc.mint(trader.address, toDecimalStr(1000, 19));
        await usdc.connect(trader).approve(vault.address, toDecimalStr(100000000000, 19));
      });

      context('when deposit 0.0000000000000000001', () => {
        it('should revert with ZeroAmount(0)', async () => {
          await expectRevertCustom(vault.connect(trader).deposit(toDecimalStr('0.0000000000000000001')), Vault, 'ZeroAmount').withArgs(0);
        });
      });

      context('when deposit 0.0000000000000000019', () => {
        let tvlChange;

        before(async () => {
          [tvlChange] = await watchBalance(usdc, [vault.address], async () => {
            await vault.connect(trader).deposit(toDecimalStr('0.0000000000000000019'));
          });
        });

        it('should increase tvl 0.000000000000000001', async () => {
          assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), '0.000000000000000001');
          assert.equal(strFromDecimal(await usdc.balanceOf(trader.address), 19), '999.999999999999999999');
          assert.equal(strFromDecimal(tvlChange, 19), '0.000000000000000001');
        });
      });
    });
  });

  describe('#withdraw', () => {
    let vault, config, usdc;

    before(async () => {
      ({ vault, config, usdc } = await setup());
    });

    context('when available 1000', () => {
      context('when normal account', () => {
        before(async () => {
          await mintAndDeposit(vault, usdc, trader);
        });

        context('when withdraw 0', () => {
          it('should revert with ZeroAmount(1)', async () => {
            await expectRevertCustom(vault.withdraw(0), Vault, 'ZeroAmount').withArgs(1);
          });
        });

        context('when withdraw 1', () => {
          let tvlChange, insuranceChange;

          before(async () => {
            [insuranceChange] = await watchBalance(vault, [insuranceAccount.address], async () => {
              [tvlChange] = await watchBalance(usdc, [vault.address], async () => {
                await vault.connect(trader).withdraw(toDecimalStr(1));
              });
            });
          });

          it('should decrease tvl 1', async () => {
            assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), '999');
            assert.equal(strFromDecimal(insuranceChange), '0');
            assert.equal(strFromDecimal(await usdc.balanceOf(trader.address), 6), '1');
            assert.equal(strFromDecimal(tvlChange, 6), '-1');
          });
        });

        context('when withdraw 1.0000001', () => {
          context('when insuranceProportion is 0.3', () => {
            let tvlChange, insuranceChange;

            before(async () => {
              await mintAndDeposit(vault, usdc, trader2);
              [insuranceChange] = await watchBalance(vault, [insuranceAccount.address], async () => {
                [tvlChange] = await watchBalance(usdc, [vault.address], async () => {
                  await vault.connect(trader2).withdraw(toDecimalStr('1.0000001'));
                });
              });
            });

            it('should decrease tvl 1', async () => {
              assert.equal(strFromDecimal(await vault.balanceOf(trader2.address)), '998.9999999');
              assert.equal(strFromDecimal(insuranceChange), '0.00000003');
              assert.equal(strFromDecimal(await usdc.balanceOf(trader2.address), 6), '1');
              assert.equal(strFromDecimal(tvlChange, 6), '-1');
            });
          });

          context('when insuranceProportion is 0', () => {
            let tvlChange, stakeholderAccountChange;

            before(async () => {
              await config.setInsuranceProportion(toDecimalStr(0));
              await mintAndDeposit(vault, usdc, otherAccount2);
              [stakeholderAccountChange] = await watchBalance(vault, [stakeholderAccount.address], async () => {
                [tvlChange] = await watchBalance(usdc, [vault.address], async () => {
                  await vault.connect(otherAccount2).withdraw(toDecimalStr('1.0000001'));
                });
              });
              await config.setInsuranceProportion(toDecimalStr(1));
            });

            it('should decrease tvl 1', async () => {
              assert.equal(strFromDecimal(await vault.balanceOf(otherAccount2.address)), '998.9999999');
              assert.equal(strFromDecimal(stakeholderAccountChange), '0.0000001');
              assert.equal(strFromDecimal(await usdc.balanceOf(otherAccount2.address), 6), '1');
              assert.equal(strFromDecimal(tvlChange, 6), '-1');
            });
          });
        });

        context('when withdraw 1001.0000001', () => {
          let tvlChange, insuranceChange;

          before(async () => {
            await mintAndDeposit(vault, usdc, otherAccount);
            [insuranceChange] = await watchBalance(vault, [insuranceAccount.address], async () => {
              [tvlChange] = await watchBalance(usdc, [vault.address], async () => {
                await vault.connect(otherAccount).withdraw(toDecimalStr('1001.0000001'));
              });
            });
          });

          it('should decrease tvl 1000', async () => {
            assert.equal(strFromDecimal(await vault.balanceOf(otherAccount.address)), '0');
            assert.equal(strFromDecimal(insuranceChange), '0');
            assert.equal(strFromDecimal(await usdc.balanceOf(otherAccount.address), 6), '1000');
            assert.equal(strFromDecimal(tvlChange, 6), '-1000');
          });
        });
      });

      context('when insurance account', () => {
        let vault, config, usdc;

        before(async () => {
          ({ vault, config, usdc } = await setup());
        });

        context('when withdraw 1.0000001', () => {
          let tvlChange;

          before(async () => {
            await mintAndDeposit(vault, usdc, insuranceAccount);
            [tvlChange] = await watchBalance(usdc, [vault.address], async () => {
              await vault.connect(insuranceAccount).withdraw(toDecimalStr('1.0000001'));
            });
          });

          it('should decrease tvl 1', async () => {
            assert.equal(strFromDecimal(await vault.balanceOf(insuranceAccount.address)), '998.99999993');
            assert.equal(strFromDecimal(await usdc.balanceOf(insuranceAccount.address), 6), '1');
            assert.equal(strFromDecimal(tvlChange, 6), '-1');
          });
        });
      });
    });

    context('when available < 0', () => {
      let vault, config, usdc, optionMarket;

      before(async () => {
        ({ vault, config, usdc, optionMarket } = await setup());
        await setupMarket(vault, optionMarket);
        await addPool(config, pool);
        await mintAndDeposit(vault, usdc, pool);
        await mintAndDeposit(vault, usdc, accounts[5]);
        await vault.connect(accounts[5]).trade(expiry, strike, true, toDecimalStr(-8), 0);
        await spotPricer.setPrice(toDecimalStr(1300));
      });

      after(async () => {
        await spotPricer.setPrice(toDecimalStr(1000));
      })

      context('when withdraw 1', () => {
        it('should revert with ZeroAmount(2)', async () => {
          await expectRevertCustom(vault.connect(accounts[5]).withdraw(1), Vault, 'ZeroAmount').withArgs(2);
        });
      });
    });
  });

  describe('#settle', () => {
    let vault, config, usdc, optionMarket;

    const subSetup = async () => {
      ({ vault, config, usdc, optionMarket } = await setup());
      await setupMarket(vault, optionMarket);
      await addPool(config, pool);
      await mintAndDeposit(vault, usdc, pool);
      await mintAndDeposit(vault, usdc, trader);
      await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-1), 0);
      return { vault, config, usdc };
    };

    before(async () => {
      ({ vault, config, usdc } = await subSetup());
    });

    context('when unexpired', () => {
      it('should revert with InvalidTime(1)', async () => {
        await expectRevertCustom(vault.connect(settler).settle(trader.address, expiry), Vault, 'InvalidTime').withArgs(1);
      });
    });

    context('when expired', () => {
      before(async () => {
        await vault.setTimestamp(expiry);
      });

      after(async () => {
        await vault.setTimestamp(now);
      });

      context('when price is unsettled', () => {
        it('should revert with Unsettled()', async () => {
          await expectRevertCustom(vault.connect(settler).settle(trader.address, expiry), Vault, 'Unsettled');
        });
      });

      context('when settled price is 1100', () => {
        before(async () => {
          await spotPricer.setSettledPrice(expiry, toDecimalStr(1100));
        });

        after(async () => {
          await spotPricer.setSettledPrice(expiry, toDecimalStr(1000));
        });

        context('when no position', () => {
          let result;

          before(async () => {
            result = await (await vault.connect(settler).settle(trader2.address, expiry)).wait();
          });

          it('should not have events', async () => {
            assert.equal(result.events.length, 0);
          });
        });

        context('when size -1', () => {
          let position, balanceChange, insuranceAccountBalanceChange;

          before(async () => {
            [balanceChange, insuranceAccountBalanceChange] = await watchBalance(vault, [trader.address, insuranceAccount.address], async () => {
              await vault.connect(settler).settle(trader.address, expiry);
            });
            position = await vault.positionOf(trader.address, expiry, strike, true);
          });

          it('should increase balance 12.752227193061747764', async () => {
            assert.equal(strFromDecimal(balanceChange), '12.752227193061747764');
          });

          it('should be size 0', async () => {
            assert.equal(strFromDecimal(position.size), '0');
          });

          it('should be notional 0', async () => {
            assert.equal(strFromDecimal(position.notional), '0');
          });

          it('should increase insurance account balance 0', async () => {
            assert.equal(strFromDecimal(insuranceAccountBalanceChange), '0');
          });
        });
      });

      context('when settled price is 1110', () => {
        before(async () => {
          ({ vault, config, usdc } = await subSetup());
          await vault.setTimestamp(expiry);
          await spotPricer.setSettledPrice(expiry, toDecimalStr(1110));
        });

        after(async () => {
          await spotPricer.setSettledPrice(expiry, toDecimalStr(1000));
        });

        context('when size -1', () => {
          context('when insuranceProportion is 0.3', () => {
            let position, balanceChange, insuranceAccountBalanceChange, stakeholderAccountBalanceCHange;

            before(async () => {
              [balanceChange, insuranceAccountBalanceChange, stakeholderAccountBalanceCHange] = await watchBalance(vault, [trader.address, insuranceAccount.address, stakeholderAccount.address], async () => {
                await vault.connect(settler).settle(trader.address, expiry);
              });
              position = await vault.positionOf(trader.address, expiry, strike, true);
            });

            it('should increase balance 2.585727193061747764', async () => {
              assert.equal(strFromDecimal(balanceChange), '2.585727193061747764');
            });

            it('should be size 0', async () => {
              assert.equal(strFromDecimal(position.size), '0');
            });

            it('should be notional 0', async () => {
              assert.equal(strFromDecimal(position.notional), '0');
            });

            // 0.1665 * 0.3
            it('should increase insurance account balance 0.04995', async () => {
              assert.equal(strFromDecimal(insuranceAccountBalanceChange), '0.04995');
            });

            it('should increase team account balance 0.11655', async () => {
              assert.equal(strFromDecimal(stakeholderAccountBalanceCHange), '0.11655');
            });
          });

          context('when insuranceProportion is 1', () => {
            let insuranceAccountBalanceChange, stakeholderAccountBalanceCHange;

            before(async () => {
              await spotPricer.setSettledPrice(expiry, toDecimalStr(1000));
              ({ vault, config, usdc } = await subSetup());
              await vault.setTimestamp(expiry);
              await spotPricer.setSettledPrice(expiry, toDecimalStr(1110));
              await config.setInsuranceProportion(toDecimalStr(1));
              [insuranceAccountBalanceChange, stakeholderAccountBalanceCHange] = await watchBalance(vault, [insuranceAccount.address, stakeholderAccount.address], async () => {
                await vault.connect(settler).settle(trader.address, expiry);
              });
            });

            it('should increase insurance account balance 0.1665', async () => {
              assert.equal(strFromDecimal(insuranceAccountBalanceChange), '0.1665');
            });

            it('should increase team account balance 0', async () => {
              assert.equal(strFromDecimal(stakeholderAccountBalanceCHange), '0');
            });
          });
        });
      });
    });
  });

  describe('#clear', () => {
    let vault, config, usdc, optionMarket;
    const strike2 = toDecimalStr(1200);

    const subSetup = async () => {
      ({ vault, config, usdc, optionMarket } = await setup());
      await config.setPoolProportion(toDecimalStr(1));
      await setupMarket(vault, optionMarket, [
        [expiry, strike, true, true, toDecimalStr(0.8), false],
        [expiry, strike, true, false, toDecimalStr(0.8), false],
        [expiry, strike, false, true, toDecimalStr(0.8), false],
        [expiry, strike, false, false, toDecimalStr(0.8), false],
        [expiry, strike2, true, true, toDecimalStr(0.8), false],
        [expiry, strike2, true, false, toDecimalStr(0.8), false]
      ]);
      await addPool(config, pool);
      await mintAndDeposit(vault, usdc, pool);
      await mintAndDeposit(vault, usdc, trader);
      await mintAndDeposit(vault, usdc, liquidator);
      await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-7), 0);
      await vault.connect(trader).trade(expiry, strike2, true, toDecimalStr('-0.000000000000000001'), 0);
      await vault.connect(trader).trade(expiry, strike, false, toDecimalStr(1), INT_MAX);
      return { vault, config, usdc };
    }

    before(async () => {
      ({ vault, config, usdc } = await subSetup());
    });

    context('when insurance account', () => {
      context('when liquidator has no balance', () => {
        it('should revert with InvalidAccount', async () => {
          await expectRevertCustom(vault.connect(liquidator).clear(insuranceAccount.address), Vault, 'InvalidAccount');
        });
      });
    });

    context('when healthFactor is 0.825126626102922852', () => {
      const spot = toDecimalStr(1100);

      before(async () => {
        await spotPricer.setPrice(spot);
      });

      after(async () => {
        await spotPricer.setPrice(toDecimalStr(1000));
      });

      context('when clearRate is 0.825126626102922852', () => {
        before(async () => {
          await config.setLiquidateRate(toDecimalStr('1'));
          await config.setClearRate(toDecimalStr('0.825126626102922852'));
        });

        after(async () => {
          await config.setClearRate(toDecimalStr('0.2'));
          await config.setLiquidateRate(toDecimalStr('0.5'));
        });

        it('should revert with CannotClear', async () => {
          await expectRevertCustom(vault.connect(liquidator).clear(trader.address), Vault, 'CannotClear');
        });
      });

      context('when clearRate is 0.825126626102922853', () => {
        let insuranceAccountBalanceChange, traderPosition, traderPosition2, traderPosition3, insuranceAccountPosition, insuranceAccountPosition2, insuranceAccountPosition3;

        before(async () => {
          await config.setLiquidateRate(toDecimalStr('1'));
          await config.setClearRate(toDecimalStr('0.825126626102922853'));
          [insuranceAccountBalanceChange] = await watchBalance(vault, [insuranceAccount.address], async () => {
            await vault.connect(liquidator).clear(trader.address);
          });
          traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
          traderPosition2 = await vault.positionOf(trader.address, expiry, strike2, true);
          traderPosition3 = await vault.positionOf(trader.address, expiry, strike, false);
          insuranceAccountPosition = await vault.positionOf(insuranceAccount.address, expiry, strike, true);
          insuranceAccountPosition2 = await vault.positionOf(insuranceAccount.address, expiry, strike2, true);
          insuranceAccountPosition3 = await vault.positionOf(insuranceAccount.address, expiry, strike, false);
          await config.setClearRate(toDecimalStr('0.2'));
          await config.setLiquidateRate(toDecimalStr('0.5'));
        });

        // trader balance: 995.579670481244244111
        // notional: 88.907557916359693035, 0.000000000000000002, -113.125393959215895965

        it('should be trader balance 0', async () => {
          assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), '0');
        });

        it('should change insurance account balance 995.579670481244244111', async () => {
          assert.equal(strFromDecimal(insuranceAccountBalanceChange), '995.579670481244244111');
        });

        it('should be trader all size 0', async () => {
          assert.equal(strFromDecimal(traderPosition.size), '0');
          assert.equal(strFromDecimal(traderPosition2.size), '0');
          assert.equal(strFromDecimal(traderPosition3.size), '0');
        });

        it('should be trader all notional 0', async () => {
          assert.equal(strFromDecimal(traderPosition.notional), '0');
          assert.equal(strFromDecimal(traderPosition2.notional), '0');
          assert.equal(strFromDecimal(traderPosition3.notional), '0');
        });

        it('should be insurance account size -7, -0.000000000000000001, 1', async () => {
          assert.equal(strFromDecimal(insuranceAccountPosition.size), '-7');
          assert.equal(strFromDecimal(insuranceAccountPosition2.size), '-0.000000000000000001');
          assert.equal(strFromDecimal(insuranceAccountPosition3.size), '1');
        });

        it('should be insurance account notional 88.907557916359693035, 0.000000000000000002, -113.125393959215895965', async () => {
          assert.equal(strFromDecimal(insuranceAccountPosition.notional), '88.907557916359693035');
          assert.equal(strFromDecimal(insuranceAccountPosition2.notional), '0.000000000000000002');
          assert.equal(strFromDecimal(insuranceAccountPosition3.notional), '-113.125393959215895965');
        });
      });
    });

    context('when marginBalance < 0 and no positions', () => {
      let vault, config, usdc;

      before(async () => {
        ({ vault, config, usdc } = await subSetup());
        await vault.setTimestamp(expiry);
        await spotPricer.setPrice(toDecimalStr(1250));
        await spotPricer.setSettledPrice(expiry, toDecimalStr(1250));
        await vault.settle(trader.address, expiry);
        [insuranceAccountBalanceChange] = await watchBalance(vault, [insuranceAccount.address], async () => {
          await vault.connect(liquidator).clear(trader.address);
        });
      });

      // trader balance: -78.825665561611958872

      it('should be trader balance 0', async () => {
        assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), '0');
      });

      it('should change insurance account balance -78.825665561611958872', async () => {
        assert.equal(strFromDecimal(insuranceAccountBalanceChange), '-78.825665561611958872');
      });
    });
  });
});
