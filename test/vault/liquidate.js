const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal, createOptionPricer, buildIv, watchBalance, addPool, mintAndDeposit, INT_MAX } = require('../support/helper');

let Vault, Config, TestERC20, SpotPricer, accounts;
describe('Vault', () => {
  let teamAccount, insuranceAccount, trader, pool, liquidator, otherAccount;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer;

  const createVault = async (configAddress) => {
    const vault = await Vault.deploy();
    await vault.initialize(configAddress, spotPricer.address, optionPricer.address);
    return vault;
  }

  const setup = async (decimals = 6) => {
    const usdc = await TestERC20.deploy('USDC', 'USDC', decimals);
    const config = await Config.deploy();
    const vault = await createVault(config.address);
    await config.initialize(vault.address, teamAccount.address, insuranceAccount.address, usdc.address, decimals);
    await optionPricer.reinitialize(config.address, vault.address);
    return { vault, config, usdc };
  };

  const setupMarket = async (vault, ivs = [[expiry, strike, true, true, toDecimalStr(0.8), false], [expiry, strike, true, false, toDecimalStr(0.8), false]]) => {
    await vault.setTimestamp(now);
    await spotPricer.setPrice(toDecimalStr(1000));
    await vault.setIv(ivs.map((iv) => buildIv(...iv)));
    await optionPricer.updateLookup(ivs.map((iv) => iv[0]));
  };

  before(async () => {
    [Vault, Config, TestERC20, SpotPricer] = await getContractFactories('TestVault', 'Config', 'TestERC20', 'TestSpotPricer');
    accounts = await ethers.getSigners();
    [teamAccount, insuranceAccount, trader, pool, liquidator, otherAccount] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer(artifacts);
  });

  describe('#liquidate', () => {
    let vault, config, usdc;
    const strike2 = toDecimalStr(1200);

    const subSetup = async () => {
      ({ vault, config, usdc } = await setup());
      await setupMarket(vault);
      await vault.setIv([
        buildIv(expiry, strike, false, true, toDecimalStr(0.8), false),
        buildIv(expiry, strike, false, false, toDecimalStr(0.8), false),
        buildIv(expiry, strike2, true, true, toDecimalStr(0.8), false),
        buildIv(expiry, strike2, true, false, toDecimalStr(0.8), false)
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

    context('when expired', () => {
      before(async () => {
        await vault.setTimestamp(expiry);
      });

      after(async () => {
        await vault.setTimestamp(now);
      });

      it('should revert with "expired"', async () => {
        await expectRevert(vault.connect(liquidator).liquidate(trader.address, expiry, strike, true, toDecimalStr(7)), 'expired');
      });
    });

    context('when not expired', () => {
      context('when position size 0', () => {
        it('should revert with "position size is 0"', async () => {
          await expectRevert(vault.connect(liquidator).liquidate(trader.address, expiry, strike2, false, toDecimalStr(7)), 'position size is 0');
        });
      });

      context('when position size is not 0', () => {
        context('when healthFactor is 0.059418777692920392', () => {
          before(async () => {
            await spotPricer.setPrice(toDecimalStr(1220));
          });

          after(async () => {
            await spotPricer.setPrice(toDecimalStr(1000));
          });

          context('when liquidator has no balance', () => {
            it('should revert with "insufficient account equity"', async () => {
              await expectRevert(vault.connect(liquidator).liquidate(trader.address, expiry, strike, true, toDecimalStr(7)), 'insufficient account equity');
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

          context('when liquidateRate is 0.825126626102922852', () => {
            before(async () => {
              await config.setLiquidateRate(toDecimalStr('0.825126626102922852'));
            });

            after(async () => {
              await config.setLiquidateRate(toDecimalStr('0.5'));
            });

            it('should revert with "can\'t liquidate"', async () => {
              await expectRevert(vault.connect(liquidator).liquidate(trader.address, expiry, strike, true, toDecimalStr(1)), 'can\'t liquidate');
            });
          });

          context('when liquidateRate is 0.825126626102922853', () => {
            before(async () => {
              await config.setLiquidateRate(toDecimalStr('0.825126626102922853'));
            });

            after(async () => {
              await config.setLiquidateRate(toDecimalStr('0.5'));
            });

            context('when liquidate buy position', () => {
              context('when sell position exists', () => {
                beforeEach(async () => {
                  await vault.setTradeDisabled(true);
                  await vault.setExpiryDisabled(expiry, true);
                  await vault.setIv([buildIv(expiry, strike2, true, true, toDecimalStr(0.8), true)]);
                });

                afterEach(async () => {
                  await vault.setTradeDisabled(false);
                  await vault.setExpiryDisabled(expiry, false);
                  await vault.setIv([buildIv(expiry, strike2, true, true, toDecimalStr(0.8), false)]);
                });

                it('should revert with "sell position first"', async () => {
                  await expectRevert(vault.connect(liquidator).liquidate(trader.address, expiry, strike, false, toDecimalStr(1)), 'sell position first');
                });
              });

              context('when no sell position', () => {
                let vault, config, usdc;
                let traderBalanceChange, liquidatorBalanceChange, insuranceAccountBalanceChange, traderPosition, liquidatorPosition;
                let traderBalanceChange2, liquidatorBalanceChange2, insuranceAccountBalanceChange2, traderPosition2, liquidatorPosition2;

                before(async () => {
                  await spotPricer.setPrice(toDecimalStr(1000));
                  ({ vault, config, usdc } = await setup());
                  await setupMarket(vault);
                  await vault.setIv([
                    buildIv(expiry, strike, false, true, toDecimalStr(0.8), false),
                    buildIv(expiry, strike, false, false, toDecimalStr(0.8), false),
                    buildIv(expiry, strike2, true, true, toDecimalStr(0.8), false),
                    buildIv(expiry, strike2, true, false, toDecimalStr(0.8), false)
                  ]);
                  await addPool(config, pool);
                  await mintAndDeposit(vault, usdc, pool, { amount: 10000 });
                  await mintAndDeposit(vault, usdc, trader);
                  await mintAndDeposit(vault, usdc, liquidator, { amount: 10000 });
                  await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-6), 0);
                  await vault.connect(trader).trade(expiry, strike, false, toDecimalStr('0.000000000000000001'), INT_MAX);
                  await vault.connect(trader).trade(expiry, strike2, true, toDecimalStr(6), INT_MAX);
                  await spotPricer.setPrice(toDecimalStr(1200));
                  await config.setLiquidateRate(toDecimalStr('0.825126626102922853'));
                  await vault.setTradeDisabled(true);
                  await vault.setExpiryDisabled(expiry, true);
                  await vault.setIv([buildIv(expiry, strike, false, true, toDecimalStr(0.8), true)]);
                  await vault.connect(liquidator).liquidate(trader.address, expiry, strike, true, toDecimalStr(6));
                  await spotPricer.setPrice(toDecimalStr(1400));
                  await vault.connect(liquidator).liquidate(trader.address, expiry, strike, true, toDecimalStr(6));
                  await spotPricer.setPrice(toDecimalStr(1300));

                  // liquidate all
                  [traderBalanceChange, liquidatorBalanceChange, insuranceAccountBalanceChange] = await watchBalance(vault, [trader.address, liquidator.address, insuranceAccount.address], async () => {
                    await vault.connect(liquidator).liquidate(trader.address, expiry, strike, false, toDecimalStr(1));
                  });
                  traderPosition = await vault.positionOf(trader.address, expiry, strike, false);
                  liquidatorPosition = await vault.positionOf(liquidator.address, expiry, strike, false);

                  // liquidate partial
                  [traderBalanceChange2, liquidatorBalanceChange2, insuranceAccountBalanceChange2] = await watchBalance(vault, [trader.address, liquidator.address, insuranceAccount.address], async () => {
                    await vault.connect(liquidator).liquidate(trader.address, expiry, strike2, true, toDecimalStr(7));
                  });
                  traderPosition2 = await vault.positionOf(trader.address, expiry, strike2, true);
                  liquidatorPosition2 = await vault.positionOf(liquidator.address, expiry, strike2, true);

                  await spotPricer.setPrice(spot);
                  await vault.setTradeDisabled(false);
                  await vault.setExpiryDisabled(expiry, false);
                  await vault.setIv([buildIv(expiry, strike, false, true, toDecimalStr(0.8), false)]);
                });

                context('when liquidate all', () => {
                  // position
                  // notional: -0.000000000000000111
                  // premium: 0.000000000000000003
                  // fee: 0
                  // reward: 0
                  // notional change: 0.000000000000000111

                  // realized = premium + fee - reward - notional change
                  it('should change trader balance -0.000000000000000108', async () => {
                    assert.equal(strFromDecimal(traderBalanceChange), '-0.000000000000000108');
                  });

                  it('should change liquidator balance 0', async () => {
                    assert.equal(strFromDecimal(liquidatorBalanceChange), '0');
                  });

                  it('should change insurance account balance 0', async () => {
                    assert.equal(strFromDecimal(insuranceAccountBalanceChange), '0');
                  });

                  it('should be trader size 0', async () => {
                    assert.equal(strFromDecimal(traderPosition.size), '0');
                  });

                  it('should be trader notional 0', async () => {
                    assert.equal(strFromDecimal(traderPosition.notional), '0');
                  });

                  it('should be liquidator size 0.000000000000000001', async () => {
                    assert.equal(strFromDecimal(liquidatorPosition.size), '0.000000000000000001');
                  });

                  it('should be liquidator notional -0.000000000000000003', async () => {
                    assert.equal(strFromDecimal(liquidatorPosition.notional), '-0.000000000000000003');
                  });
                });

                context('when liquidate partial', () => {
                  // size 6
                  // premium: 720.278795636963590878
                  // fee: -9.542787956369635908
                  // available: -158.656794908544846652
                  // maxLiquidation = 158.656794908544846652 + 72.027879563696359087 = 230.684674472241205739
                  // resize = 6 * 230.684674472241205739 / (720.278795636963590878 - 9.542787956369635908) = 1.947429188722724584

                  // liquidate size 1.947429188722724584
                  // premium: 233.781991773578856918
                  // fee: -3.097317301337651156

                  // position
                  // notional: -15.595913507734673472
                  // premium: 233.781991773578856918
                  // fee: -3.097317301337651156
                  // reward: 23.378199177357885691
                  // notional change: 5.06198953162625283

                  // realized = premium + fee - reward - notional change
                  //          = 233.781991773578856918 - 3.097317301337651156 - 23.378199177357885691 - 5.06198953162625283
                  it('should change trader balance 202.244485763257067241', async () => {
                    assert.equal(strFromDecimal(traderBalanceChange2), '202.244485763257067241');
                  });

                  it('should change liquidator balance 23.378199177357885691', async () => {
                    assert.equal(strFromDecimal(liquidatorBalanceChange2), '23.378199177357885691');
                  });

                  it('should change insurance account balance 3.097317301337651156', async () => {
                    assert.equal(strFromDecimal(insuranceAccountBalanceChange2), '3.097317301337651156');
                  });

                  it('should be trader size 4.052570811277275416', async () => {
                    assert.equal(strFromDecimal(traderPosition2.size), '4.052570811277275416');
                  });

                  // notional - notional change
                  it('should be trader notional -10.533923976108420642', async () => {
                    assert.equal(strFromDecimal(traderPosition2.notional), '-10.533923976108420642');
                  });

                  it('should be liquidator size 1.947429188722724584', async () => {
                    assert.equal(strFromDecimal(liquidatorPosition2.size), '1.947429188722724584');
                  });

                  it('should be liquidator notional -233.781991773578856918', async () => {
                    assert.equal(strFromDecimal(liquidatorPosition2.notional), '-233.781991773578856918');
                  });
                });
              });
            });

            context('when liquidate sell position', () => {
              context('when size 0', () => {
                it('should revert with "invalid size"', async () => {
                  await expectRevert(vault.connect(liquidator).liquidate(trader.address, expiry, strike, true, 0), 'invalid size');
                });
              });

              context('when size -1', () => {
                it('should revert with "invalid size"', async () => {
                  await expectRevert(vault.connect(liquidator).liquidate(trader.address, expiry, strike, true, toDecimalStr(-1)), 'invalid size');
                });
              });

              context('when size 1', () => {
                context('when liquidator has no balance', () => {
                  it('should revert with "liquidator unavailable"', async () => {
                    await expectRevert(vault.connect(otherAccount).liquidate(trader.address, expiry, strike, true, toDecimalStr(1)), 'liquidator unavailable');
                  });
                });

                context('when liquidator has balance', () => {
                  context('when insuranceProportion is 1', () => {
                    context('when strike 1200', () => {
                      let traderBalanceChange, liquidatorBalanceChange, insuranceAccountBalanceChange, traderPosition, liquidatorPosition;

                      before(async () => {
                        traderPosition = await vault.positionOf(trader.address, expiry, strike2, true);
                        [traderBalanceChange, liquidatorBalanceChange, insuranceAccountBalanceChange] = await watchBalance(vault, [trader.address, liquidator.address, insuranceAccount.address], async () => {
                          await vault.connect(liquidator).liquidate(trader.address, expiry, strike2, true, toDecimalStr(1));
                        });
                        traderPosition = await vault.positionOf(trader.address, expiry, strike2, true);
                        liquidatorPosition = await vault.positionOf(liquidator.address, expiry, strike2, true);
                      });

                      // position
                      // notional: 0.000000000000000002
                      // premium: -0.000000000000000015
                      // fee: 0
                      // reward: 0.000000000000000001
                      // notional change: -0.000000000000000002

                      // realized = premium + fee - reward - notional change
                      it('should change trader balance -0.000000000000000014', async () => {
                        assert.equal(strFromDecimal(traderBalanceChange), '-0.000000000000000014');
                      });

                      it('should change liquidator balance 0.000000000000000001', async () => {
                        assert.equal(strFromDecimal(liquidatorBalanceChange), '0.000000000000000001');
                      });

                      it('should change insurance account balance 0', async () => {
                        assert.equal(strFromDecimal(insuranceAccountBalanceChange), '0');
                      });

                      it('should be trader size 0', async () => {
                        assert.equal(strFromDecimal(traderPosition.size), '0');
                      });

                      it('should be trader notional 0', async () => {
                        assert.equal(strFromDecimal(traderPosition.notional), '0');
                      });

                      it('should be liquidator size -0.000000000000000001', async () => {
                        assert.equal(strFromDecimal(liquidatorPosition.size), '-0.000000000000000001');
                      });

                      it('should be liquidator notional 0.000000000000000015', async () => {
                        assert.equal(strFromDecimal(liquidatorPosition.notional), '0.000000000000000015');
                      });
                    });

                    context('when strike 1100', () => {
                      let traderBalanceChange, liquidatorBalanceChange, insuranceAccountBalanceChange, traderPosition, liquidatorPosition;

                      before(async () => {
                        [traderBalanceChange, liquidatorBalanceChange, insuranceAccountBalanceChange] = await watchBalance(vault, [trader.address, liquidator.address, insuranceAccount.address], async () => {
                          await vault.connect(liquidator).liquidate(trader.address, expiry, strike, true, toDecimalStr(1));
                        });
                        traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
                        liquidatorPosition = await vault.positionOf(liquidator.address, expiry, strike, true);
                      });

                      // position
                      // notional: 88.907557916359693035
                      // premium: -49.199543314587573822
                      // fee: -0.821995433145875738
                      // reward: 4.919954331458757382
                      // notional change: -12.701079702337099005

                      // realized = premium + fee - reward - notional change
                      it('should change trader balance -42.240413376855107937', async () => {
                        assert.equal(strFromDecimal(traderBalanceChange), '-42.240413376855107937');
                      });

                      it('should change liquidator balance 4.919954331458757382', async () => {
                        assert.equal(strFromDecimal(liquidatorBalanceChange), '4.919954331458757382');
                      });

                      it('should change insurance account balance 0.821995433145875738', async () => {
                        assert.equal(strFromDecimal(insuranceAccountBalanceChange), '0.821995433145875738');
                      });

                      it('should be trader size -6', async () => {
                        assert.equal(strFromDecimal(traderPosition.size), '-6');
                      });

                      it('should be trader notional 76.20647821402259403', async () => {
                        assert.equal(strFromDecimal(traderPosition.notional), '76.20647821402259403');
                      });

                      it('should be liquidator size -1', async () => {
                        assert.equal(strFromDecimal(liquidatorPosition.size), '-1');
                      });

                      it('should be liquidator notional 49.199543314587573822', async () => {
                        assert.equal(strFromDecimal(liquidatorPosition.notional), '49.199543314587573822');
                      });
                    });
                  });

                  context('when insuranceProportion is 0.3', () => {
                    let vault, config, usdc;
                    let insuranceAccountBalanceChange, teamAccountBalanceChange;

                    before(async () => {
                      await spotPricer.setPrice(toDecimalStr(1000));
                      ({ vault, config, usdc } = await subSetup());
                      await spotPricer.setPrice(spot);
                      await config.setLiquidateRate(toDecimalStr('0.825126626102922853'));
                      await config.setInsuranceProportion(toDecimalStr(0.33));
                      [insuranceAccountBalanceChange, teamAccountBalanceChange] = await watchBalance(vault, [insuranceAccount.address, teamAccount.address], async () => {
                        await vault.connect(liquidator).liquidate(trader.address, expiry, strike, true, toDecimalStr(1));
                      });
                    });

                    // 0.821995433145875738 * 0.33
                    it('should change insurance account balance 0.271258492938138993', async () => {
                      assert.equal(strFromDecimal(insuranceAccountBalanceChange), '0.271258492938138993');
                    });

                    it('should change team account balance 0.550736940207736745', async () => {
                      assert.equal(strFromDecimal(teamAccountBalanceChange), '0.550736940207736745');
                    });
                  });
                });
              });
            });
          });
        });

        context('when position size small', () => {
          let vault, config, usdc;
          let traderBalanceChange, liquidatorBalanceChange, insuranceAccountBalanceChange, traderPosition, liquidatorPosition;

          before(async () => {
            await spotPricer.setPrice(toDecimalStr(1000));
            ({ vault, config, usdc } = await setup());
            await setupMarket(vault);
            await addPool(config, pool);
            await mintAndDeposit(vault, usdc, pool);
            await mintAndDeposit(vault, usdc, trader, { amount: 100 });
            await mintAndDeposit(vault, usdc, liquidator);
            await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-0.7), 0);
            await spotPricer.setPrice(toDecimalStr(1200));

            [traderBalanceChange, liquidatorBalanceChange, insuranceAccountBalanceChange] = await watchBalance(vault, [trader.address, liquidator.address, insuranceAccount.address], async () => {
              await vault.connect(liquidator).liquidate(trader.address, expiry, strike, true, toDecimalStr(0.7));
            });
            traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
            liquidatorPosition = await vault.positionOf(liquidator.address, expiry, strike, true);

            await spotPricer.setPrice(toDecimalStr(1000));
          });

          // position
          // notional: 8.928356768311174191
          // premium: -81.659345565058989366
          // fee: -1.068593455650589893
          // reward: 8.165934556505898936
          // notional change: -8.928356768311174191

          // realized = premium + fee - reward - notional change
          it('should change trader balance -81.965516808904304004', async () => {
            assert.equal(strFromDecimal(traderBalanceChange), '-81.965516808904304004');
          });

          it('should change liquidator balance 8.165934556505898936', async () => {
            assert.equal(strFromDecimal(liquidatorBalanceChange), '8.165934556505898936');
          });

          it('should change insurance account balance 1.068593455650589893', async () => {
            assert.equal(strFromDecimal(insuranceAccountBalanceChange), '1.068593455650589893');
          });

          it('should be trader size 0', async () => {
            assert.equal(strFromDecimal(traderPosition.size), '0');
          });

          it('should be trader notional 0', async () => {
            assert.equal(strFromDecimal(traderPosition.notional), '0');
          });

          it('should be liquidator size -0.7', async () => {
            assert.equal(strFromDecimal(liquidatorPosition.size), '-0.7');
          });

          it('should be liquidator notional 81.659345565058989366', async () => {
            assert.equal(strFromDecimal(liquidatorPosition.notional), '81.659345565058989366');
          });
        });
      });
    });
  });
});
