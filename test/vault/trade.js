const assert = require('assert');
const { getSigners, getContractFactories, toDecimalStr, strFromDecimal, createOptionPricer, buildIv, mergeIv, watchBalance, addPool, mintAndDeposit, INT_MAX, expectRevertCustom } = require('../support/helper');

let Vault, Config, OptionMarket, TestERC20, SpotPricer, accounts;
describe('Vault', () => {
  let stakeholderAccount, insuranceAccount, trader, trader2, pool, pool2, pool3;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer;

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
    await config.setPoolProportion(toDecimalStr(1));
    await optionMarket.initialize();
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
    [Vault, Config, OptionMarket, TestERC20, SpotPricer] = await getContractFactories('TestVault', 'Config', 'TestOptionMarket', 'TestERC20', 'TestSpotPricer');
    accounts = await getSigners();
    [stakeholderAccount, insuranceAccount, trader, trader2, pool, pool2, pool3] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer();
  });

  describe('#trade', () => {
    let vault, config, usdc, optionMarket;

    const subSetup = async () => {
      ({ vault, config, usdc, optionMarket } = await setup());
      await setupMarket(vault, optionMarket);
      return { vault, config, usdc, optionMarket };
    };

    const reset = async () => {
      await vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, 0);
      await vault.connect(trader).deposit(toDecimalStr(1000));
      await vault.connect(pool).withdrawPercent(toDecimalStr(1), 0, 0);
      await vault.connect(pool).deposit(toDecimalStr(1000));
    };

    before(async () => {
      ({ vault, config, usdc } = await subSetup());
      await addPool(config, pool);
      await addPool(config, pool2);
      await mintAndDeposit(vault, usdc, pool, { mint: 10000000 });
      await mintAndDeposit(vault, usdc, trader, { mint: 10000000 });
    });

    context('when tradeDisabled is true', () => {
      beforeEach(async () => {
        await optionMarket.setTradeDisabled(true);
      });

      afterEach(async () => {
        await optionMarket.setTradeDisabled(false);
      });

      it('should revert with TradeDisabled', async () => {
        await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX]), Vault, 'TradeDisabled');
      });
    });

    context('when expiryDisabled is true', () => {
      beforeEach(async () => {
        await optionMarket.setExpiryDisabled(expiry, true);
      });

      afterEach(async () => {
        await optionMarket.setExpiryDisabled(expiry, false);
      });

      it('should revert with TradeDisabled', async () => {
        await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX]), Vault, 'TradeDisabled');
      });
    });

    context('when marketDisabled is true', () => {
      context('when disable buy', () => {
        beforeEach(async () => {
          await optionMarket.setIv(mergeIv([buildIv(expiry, strike, true, true, toDecimalStr(0.8), true)]));
        });

        afterEach(async () => {
          await optionMarket.setIv(mergeIv([
            buildIv(expiry, strike, true, true, toDecimalStr(0.8), false),
            buildIv(expiry, strike, true, false, toDecimalStr(0.8), false)
          ]));
        });

        it('should revert with TradeDisabled', async () => {
        await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX]), Vault, 'TradeDisabled');
        });
      });

      context('when disable sell', () => {
        beforeEach(async () => {
          await optionMarket.setIv(mergeIv([buildIv(expiry, strike, true, false, toDecimalStr(0.8), true)]));
        });

        afterEach(async () => {
          await optionMarket.setIv(mergeIv([
            buildIv(expiry, strike, true, true, toDecimalStr(0.8), false),
            buildIv(expiry, strike, true, false, toDecimalStr(0.8), false)
          ]));
        });

        it('should revert with TradeDisabled', async () => {
          await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(-1), 0]), Vault, 'TradeDisabled');
        });
      });
    });

    context('when not disabled', () => {
      context('when now is expired', () => {
        beforeEach(async () => {
          await vault.setTimestamp(expiry);
          await optionMarket.setIv([]);
        });

        afterEach(async () => {
          await vault.setTimestamp(now);
          await optionMarket.setIv([]);
        });

        it('should revert with InvalidTime(0)', async () => {
          await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX]), Vault, 'InvalidTime').withArgs(0);
        });
      });

      context('when iv is outdated', () => {
        beforeEach(async () => {
          await vault.setTimestamp(now + 3601);
        });

        afterEach(async () => {
          await vault.setTimestamp(now);
        });

        it('should revert with IvOutdated', async () => {
          await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX]), Vault, 'IvOutdated');
        });
      });

      context('when 7 days to expire', () => {
        context('when pool available 1000', () => {
          context('when size is 0', () => {
            it('should revert with InvalidSize(0)', async () => {
              await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(0), INT_MAX]), Vault, 'InvalidSize').withArgs(0);
            });
          });

          context('when size is 1', () => {
            context('when trader not available', () => {
              it('should revert with Unavailable(2)', async () => {
                await expectRevertCustom(vault.connect(trader2).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX]), Vault, 'Unavailable').withArgs(2);
              });
            });

            context('when acceptableTotal is 13.256233453364095893', () => {
              it('should revert with UnacceptablePrice', async () => {
                await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), toDecimalStr('13.256233453364095893')]), Vault, 'UnacceptablePrice');
              });
            });

            context('when acceptableTotal is 13.256233453364095894', () => {
              const acceptableTotal = toDecimalStr('13.256233453364095894');

              context('when poolProportion is 1', () => {
                let traderChange, poolChange, traderPosition, poolPosition;

                before(async () => {
                  await optionMarket.setIv(mergeIv([
                    buildIv(expiry, strike, true, true, toDecimalStr(0.8), false),
                    buildIv(expiry, strike, true, false, toDecimalStr(0.8), true)
                  ]));
                  [traderChange, poolChange] = await watchBalance(vault, [trader.address, pool.address], async () => {
                    await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), acceptableTotal]);
                  });
                  traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
                  poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
                  await optionMarket.setIv(mergeIv([
                    buildIv(expiry, strike, true, true, toDecimalStr(0.8), false),
                    buildIv(expiry, strike, true, false, toDecimalStr(0.8), false)
                  ]));
                  await reset();
                });

                // fee: 0.428279539142218771
                it('should be trader size 1', async () => {
                  assert.equal(strFromDecimal(traderPosition.size), '1');
                });

                it('should be trader notional -12.827953914221877123', async () => {
                  assert.equal(strFromDecimal(traderPosition.notional), '-12.827953914221877123');
                });

                it('should be pool size -1', async () => {
                  assert.equal(strFromDecimal(poolPosition.size), '-1');
                });

                it('should be pool notional 12.827953914221877123', async () => {
                  assert.equal(strFromDecimal(poolPosition.notional), '12.827953914221877123');
                });

                it('should change trader balance -0.428279539142218771', async () => {
                  assert.equal(strFromDecimal(traderChange), '-0.428279539142218771');
                });

                it('should change pool balance 0.428279539142218771', async () => {
                  assert.equal(strFromDecimal(poolChange), '0.428279539142218771');
                });
              });

              context('when poolProportion is 0.3', () => {
                context('when insuranceProportion is 1', () => {
                  let poolChange, insuranceAccountChange, stakeholderAccountChange;

                  before(async () => {
                    await config.setPoolProportion(toDecimalStr(0.3));
                    await config.setInsuranceProportion(toDecimalStr(1));
                    [poolChange, insuranceAccountChange, stakeholderAccountChange] = await watchBalance(vault, [pool.address, insuranceAccount.address, stakeholderAccount.address], async () => {
                      await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), acceptableTotal]);
                    });
                    await config.setPoolProportion(toDecimalStr(1));
                    await config.setInsuranceProportion(toDecimalStr(0.3));
                    await reset();
                  });

                  // fee: 0.428279539142218771
                  it('should change pool balance 0.128483861742665631', async () => {
                    assert.equal(strFromDecimal(poolChange), '0.128483861742665631');
                  });

                  it('should change insurance Account balance 0.29979567739955314', async () => {
                    assert.equal(strFromDecimal(insuranceAccountChange), '0.29979567739955314');
                  });

                  it('should change insurance Account balance 0', async () => {
                    assert.equal(strFromDecimal(stakeholderAccountChange), '0');
                  });
                });

                context('when insuranceProportion is 0.3', () => {
                  let poolChange, insuranceAccountChange, stakeholderAccountChange;

                  before(async () => {
                    await config.setPoolProportion(toDecimalStr(0.3));
                    [poolChange, insuranceAccountChange, stakeholderAccountChange] = await watchBalance(vault, [pool.address, insuranceAccount.address, stakeholderAccount.address], async () => {
                      await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), acceptableTotal]);
                    });
                    await config.setPoolProportion(toDecimalStr(1));
                    await reset();
                  });

                  // fee: 0.428279539142218771
                  it('should change pool balance 0.128483861742665631', async () => {
                    assert.equal(strFromDecimal(poolChange), '0.128483861742665631');
                  });

                  // 0.29979567739955314 * 0.3
                  it('should change insurance Account balance 0.089938703219865942', async () => {
                    assert.equal(strFromDecimal(insuranceAccountChange), '0.089938703219865942');
                  });

                  it('should change insurance Account balance 0.209856974179687198', async () => {
                    assert.equal(strFromDecimal(stakeholderAccountChange), '0.209856974179687198');
                  });
                });
              });
            });

            context('when spot 500, minPremium 0 and fee 0', () => {
              beforeEach(async () => {
                await spotPricer.setPrice(toDecimalStr(500));
                await config.setMinPremium(toDecimalStr(0));
                await config.setSpotFee(toDecimalStr(0));
              });

              afterEach(async () => {
                await spotPricer.setPrice(toDecimalStr(1000));
                await config.setMinPremium(toDecimalStr(1));
                await config.setSpotFee(toDecimalStr(0.0003));
              });

              it('should revert with ZeroPrice', async () => {
                await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX]), Vault, 'ZeroPrice');
              });
            });

            context('when then other no balance account size -1', () => {
              before(async () => {
                await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX]);
              });

              after(async () => {
                await reset();
              });

              it('should revert with Unavailable(2)', async () => {
                await expectRevertCustom(vault.connect(pool3).trade([expiry, strike, 1, toDecimalStr(-1), 0]), Vault, 'Unavailable').withArgs(2);
              });
            });
          });

          context('when size is -1', () => {
            context('when open only', () => {
              context('when acceptableTotal is 12.324704921131130288', () => {
                it('should revert with UnacceptablePrice', async () => {
                  await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(-1), toDecimalStr('12.324704921131130288')]), Vault, 'UnacceptablePrice');
                });
              });

              context('when acceptableTotal is 12.324704921131130287', () => {
                let traderChange, poolChange, traderPosition, poolPosition;

                before(async () => {
                  await optionMarket.setIv(mergeIv([
                    buildIv(expiry, strike, true, true, toDecimalStr(0.8), true),
                    buildIv(expiry, strike, true, false, toDecimalStr(0.8), false)
                  ]));
                  [traderChange, poolChange] = await watchBalance(vault, [trader.address, pool.address], async () => {
                    await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(-1), toDecimalStr('12.324704921131130287')]);
                  });
                  traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
                  poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
                  await optionMarket.setIv(mergeIv([
                    buildIv(expiry, strike, true, true, toDecimalStr(0.8), false),
                    buildIv(expiry, strike, true, false, toDecimalStr(0.8), false)
                  ]));
                  await reset();
                });

                // fee: 0.427522271930617477
                it('should be trader size -1', async () => {
                  assert.equal(strFromDecimal(traderPosition.size), '-1');
                });

                it('should be trader notional 12.752227193061747764', async () => {
                  assert.equal(strFromDecimal(traderPosition.notional), '12.752227193061747764');
                });

                it('should be pool size 1', async () => {
                  assert.equal(strFromDecimal(poolPosition.size), '1');
                });

                it('should be pool notional -12.752227193061747764', async () => {
                  assert.equal(strFromDecimal(poolPosition.notional), '-12.752227193061747764');
                });

                it('should change trader balance -0.427522271930617477', async () => {
                  assert.equal(strFromDecimal(traderChange), '-0.427522271930617477');
                });

                it('should change pool balance 0.427522271930617477', async () => {
                  assert.equal(strFromDecimal(poolChange), '0.427522271930617477');
                });
              });

              context('when spot 500', () => {
                beforeEach(async () => {
                  await spotPricer.setPrice(toDecimalStr(500));
                });

                afterEach(async () => {
                  await spotPricer.setPrice(toDecimalStr(1000));
                });

                it('should revert with ZeroPrice', async () => {
                  await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(-1), 0]), Vault, 'ZeroPrice');
                });
              });
            });

            context('when then size 2', () => {
              let traderChange, poolChange, traderPosition, poolPosition;

              before(async () => {
                await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(-1), 0]);
                [traderChange, poolChange] = await watchBalance(vault, [trader.address, pool.address], async () => {
                  await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(2), INT_MAX]);
                });
                traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
                poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
                await reset();
              });

              // closePremium: -12.760791851843752114
              // closeFee: -0.427607918518437521
              // premium: -12.827895956752105513
              // fee: -0.428278959567521055

              // trader
              // total premium: -25.588687808595857627
              // total fee: -0.855886878085958576
              // realized: -0.042116711236181049
              // notional: -25.546571097359676578

              // pool
              // close
              // realized: 0.008564658782004350
              // notional: 12.752227193061747764
              // open
              // notional = premium = 12.827895956752105513

              it('should be trader size 1', async () => {
                assert.equal(strFromDecimal(traderPosition.size), '1');
              });

              it('should be trader notional -12.794343904297928814', async () => {
                assert.equal(strFromDecimal(traderPosition.notional), '-12.794343904297928814');
              });

              it('should be pool size -1', async () => {
                assert.equal(strFromDecimal(poolPosition.size), '-1');
              });

              it('should be pool notional 12.827895956752105513', async () => {
                assert.equal(strFromDecimal(poolPosition.notional), '12.827895956752105513');
              });

              // realized + total fee
              it('should change trader balance -0.898003589322139625', async () => {
                assert.equal(strFromDecimal(traderChange), '-0.898003589322139625');
              });

              // realized + total fee
              it('should change pool balance 0.864451536867962926', async () => {
                assert.equal(strFromDecimal(poolChange), '0.864451536867962926');
              });
            });

            context('when hf < 1', () => {
              context('when then size 0.1', () => {
                let accountInfoBefore, accountInfoAfter;

                before(async () => {
                  await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(-1), 0]);
                  await spotPricer.setPrice(toDecimalStr(1950));
                  accountInfoBefore = await vault.getAccountInfo(trader.address);
                  await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(0.1), INT_MAX]);
                  accountInfoAfter = await vault.getAccountInfo(trader.address);
                  await spotPricer.setPrice(toDecimalStr(1000));
                  await reset();
                });

                it('should increase healthFactor', async () => {
                  assert.equal(accountInfoAfter.healthFactor.gt(accountInfoBefore.healthFactor), true);
                });
              });
            });
          });

          context('when size is 20', () => {
            it('should revert with Unavailable(1)', async () => {
              await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(20), INT_MAX]), Vault, 'Unavailable').withArgs(1);
            });
          });

          context('when batch', () => {
            before(async () => {
              await optionMarket.setIv(mergeIv([
                buildIv(expiry, strike, true, true, toDecimalStr(0.8), false),
                buildIv(expiry, strike, true, false, toDecimalStr(0.8), false),
                buildIv(expiry, strike, false, true, toDecimalStr(0.8), false),
                buildIv(expiry, strike, false, false, toDecimalStr(0.8), false)
              ]));
            });

            context('when length 0', () => {
              it('should revert with InvalidInput', async () => {
                await expectRevertCustom(vault.connect(trader).trade([]), Vault, 'InvalidInput');
              });
            });

            context('when length 6', () => {
              it('should revert with InvalidInput', async () => {
                await expectRevertCustom(vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX, 0]), Vault, 'InvalidInput');
              });
            });

            context('when buy call and put', () => {
              let traderChange, poolChange, traderPosition, traderPosition2, poolPosition, poolPosition2;

              before(async () => {
                [traderChange, poolChange] = await watchBalance(vault, [trader.address, pool.address], async () => {
                  const tx = await vault.connect(trader).trade([
                    expiry, strike, 1, toDecimalStr(1), INT_MAX,
                    expiry, strike, 0, toDecimalStr(1), INT_MAX,
                  ]);
                });
                traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
                traderPosition2 = await vault.positionOf(trader.address, expiry, strike, false);
                poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
                poolPosition2 = await vault.positionOf(pool.address, expiry, strike, false);
                await reset();
              });

              it('should be trader size 1', async () => {
                assert.equal(strFromDecimal(traderPosition.size), '1');
                assert.equal(strFromDecimal(traderPosition2.size), '1');
              });

              it('should be pool size -1', async () => {
                assert.equal(strFromDecimal(poolPosition.size), '-1');
                assert.equal(strFromDecimal(poolPosition2.size), '-1');
              });
            });

            context('when hf < 1', () => {
              context('when all close', () => {
                let accountInfoBefore, accountInfoAfter;

                before(async () => {
                  await vault.connect(trader).trade([
                    expiry, strike, 1, toDecimalStr(-1), 0,
                    expiry, strike, 0, toDecimalStr(-0.001), 0
                  ]);
                  await spotPricer.setPrice(toDecimalStr(1950));
                  accountInfoBefore = await vault.getAccountInfo(trader.address);
                  await vault.connect(trader).trade([
                    expiry, strike, 1, toDecimalStr(0.1), INT_MAX,
                    expiry, strike, 0, toDecimalStr(0.001), INT_MAX
                  ]);
                  accountInfoAfter = await vault.getAccountInfo(trader.address);
                  await spotPricer.setPrice(toDecimalStr(1000));
                  await reset();
                });

                it('should increase healthFactor', async () => {
                  assert.equal(accountInfoAfter.healthFactor.gt(accountInfoBefore.healthFactor), true);
                });
              });

              context('when not all close', () => {
                before(async () => {
                  await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr(-1), 0]);
                  await spotPricer.setPrice(toDecimalStr(1950));
                });

                after(async () => {
                  await spotPricer.setPrice(toDecimalStr(1000));
                  await reset();
                });

                it('should revert with Unavailable(2)', async () => {
                  await expectRevertCustom(vault.connect(trader).trade([
                    expiry, strike, 1, toDecimalStr(0.1), INT_MAX,
                    expiry, strike, 0, toDecimalStr(0.1), INT_MAX,
                  ]), Vault, 'Unavailable').withArgs(2);
                });
              });
            });
          });
        });

        context('when 3 pools available 4000', () => {
          const subSetup2 = async () => {
            ({ vault, config, usdc } = await subSetup());
            await addPool(config, pool);
            await mintAndDeposit(vault, usdc, pool);

            await addPool(config, pool2);
            await mintAndDeposit(vault, usdc, pool2);

            await addPool(config, pool3);
            await mintAndDeposit(vault, usdc, pool3, { amount: 2000 });
            await config.connect(pool3).setPoolReservedRate(toDecimalStr(0.5));
            await mintAndDeposit(vault, usdc, trader);
            return { vault, config, usdc };
          };

          context('when size is 1.000000000000000001', () => {
            context('when open only', () => {
              let vault, config, usdc, traderChange, poolChange, poolChange2, poolChange3;

              before(async () => {
                ({ vault, config, usdc } = await subSetup2());

                [traderChange, poolChange, poolChange2, poolChange3] = await watchBalance(vault, [trader.address, pool.address, pool2.address, pool3.address], async () => {
                  await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr('1.000000000000000001'), INT_MAX]);
                });
              });

              it('should have position"', async () => {
                // fee: 0.427775823674382833
                let position = await vault.positionOf(trader.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '1.000000000000000001');
                assert.equal(strFromDecimal(position.notional), '-12.777582367438283372');
                assert.equal(strFromDecimal(traderChange), '-0.427775823674382833');

                position = await vault.positionOf(pool.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '-0.333333333333333333');
                assert.equal(strFromDecimal(position.notional), '4.259194122479427786');
                assert.equal(strFromDecimal(poolChange), '0.142591941224794277');

                position = await vault.positionOf(pool2.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '-0.333333333333333333');
                assert.equal(strFromDecimal(position.notional), '4.259194122479427786');
                assert.equal(strFromDecimal(poolChange2), '0.142591941224794277');

                position = await vault.positionOf(pool3.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '-0.333333333333333335');
                assert.equal(strFromDecimal(position.notional), '4.2591941224794278');
                assert.equal(strFromDecimal(poolChange3), '0.142591941224794279');
              });
            });

            context('when trader2 size -1.000000000000000001', () => {
              let vault, config, usdc, traderChange, poolChange, poolChange2, poolChange3;

              before(async () => {
                ({ vault, config, usdc } = await subSetup2());
                await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr('1.000000000000000001'), INT_MAX]);
                await mintAndDeposit(vault, usdc, trader2);
                [traderChange, poolChange, poolChange2, poolChange3] = await watchBalance(vault, [trader2.address, pool.address, pool2.address, pool3.address], async () => {
                  await vault.connect(trader2).trade([expiry, strike, 1, toDecimalStr('-1.000000000000000001'), 0]);
                });
              });

              it('should have position"', async () => {
                // fee: 0.427607918518437521
                let position = await vault.positionOf(trader2.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '-1.000000000000000001');
                assert.equal(strFromDecimal(position.notional), '12.760791851843752126');
                assert.equal(strFromDecimal(traderChange), '-0.427607918518437521');

                // notional: 4.253597283947917371
                // realized: 0.005596838531510415
                // fee: 0.142535972839479173
                position = await vault.positionOf(pool.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '0');
                assert.equal(strFromDecimal(position.notional), '0');
                assert.equal(strFromDecimal(poolChange), '0.148132811370989588');

                position = await vault.positionOf(pool2.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '0');
                assert.equal(strFromDecimal(position.notional), '0');
                assert.equal(strFromDecimal(poolChange2), '0.148132811370989588');

                // notional: 4.253597283947917384
                // realized: 0.005596838531510416
                // fee: 0.142535972839479175
                position = await vault.positionOf(pool3.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '0');
                assert.equal(strFromDecimal(position.notional), '0');
                assert.equal(strFromDecimal(poolChange3), '0.148132811370989591');
              });
            });

            context('when trader2 -1.000000000000000002', () => {
              let vault, config, usdc, traderChange, poolChange, poolChange2, poolChange3;

              before(async () => {
                ({ vault, config, usdc } = await subSetup2());
                await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr('1.000000000000000001'), INT_MAX]);
                await mintAndDeposit(vault, usdc, trader2);
                [traderChange, poolChange, poolChange2, poolChange3] = await watchBalance(vault, [trader2.address, pool.address, pool2.address, pool3.address], async () => {
                  await vault.connect(trader2).trade([expiry, strike, 1, toDecimalStr('-1.000000000000000002'), 0]);
                });
              });

              it('should have position"', async () => {
                let position = await vault.positionOf(trader2.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '-1.000000000000000002');
                assert.equal(strFromDecimal(position.notional), '12.760791851843752138');
                assert.equal(strFromDecimal(traderChange), '-0.427607918518437521');

                position = await vault.positionOf(pool.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '0');
                assert.equal(strFromDecimal(position.notional), '0');
                assert.equal(strFromDecimal(poolChange), '0.148132811370989588');

                position = await vault.positionOf(pool2.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '0');
                assert.equal(strFromDecimal(position.notional), '0');
                assert.equal(strFromDecimal(poolChange2), '0.148132811370989588');

                position = await vault.positionOf(pool3.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '0.000000000000000001');
                assert.equal(strFromDecimal(position.notional), '-0.000000000000000012');
                assert.equal(strFromDecimal(poolChange3), '0.148132811370989591');
              });
            });

            context('when trader2 -1', () => {
              let vault, config, usdc, traderChange, poolChange, poolChange2, poolChange3;

              before(async () => {
                ({ vault, config, usdc } = await subSetup2());
                await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr('1.000000000000000001'), INT_MAX]);
                await mintAndDeposit(vault, usdc, trader2);
                [traderChange, poolChange, poolChange2, poolChange3] = await watchBalance(vault, [trader2.address, pool.address, pool2.address, pool3.address], async () => {
                  await vault.connect(trader2).trade([expiry, strike, 1, toDecimalStr('-1'), 0]);
                });
              });

              it('should have position"', async () => {
                // fee: 0.427607918518437521
                let position = await vault.positionOf(trader2.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '-1');
                assert.equal(strFromDecimal(position.notional), '12.760791851843752114');
                assert.equal(strFromDecimal(traderChange), '-0.427607918518437521');

                // notional: 4.253597283947917367
                // realized: 0.005596838531510419
                // fee: 0.142535972839479173
                position = await vault.positionOf(pool.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '0');
                assert.equal(strFromDecimal(position.notional), '0');
                assert.equal(strFromDecimal(poolChange), '0.148132811370989592');

                position = await vault.positionOf(pool2.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '0');
                assert.equal(strFromDecimal(position.notional), '0');
                assert.equal(strFromDecimal(poolChange2), '0.148132811370989592');

                position = await vault.positionOf(pool3.address, expiry, strike, true);
                assert.equal(strFromDecimal(position.size), '-0.000000000000000001');
                assert.equal(strFromDecimal(position.notional), '0.000000000000000015');
                assert.equal(strFromDecimal(poolChange3), '0.14813281137098958');
              });
            });
          });

          context('when size is -1.000000000000000001', () => {
            let vault, config, usdc, traderChange, poolChange, poolChange2, poolChange3;

            before(async () => {
              ({ vault, config, usdc } = await subSetup2());
              [traderChange, poolChange, poolChange2, poolChange3] = await watchBalance(vault, [trader.address, pool.address, pool2.address, pool3.address], async () => {
                await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr('-1.000000000000000001'), 0]);
              });
            });

            it('should have position"', async () => {
              // fee: 0.427586496087915363
              let position = await vault.positionOf(trader.address, expiry, strike, true);
              assert.equal(strFromDecimal(position.size), '-1.000000000000000001');
              assert.equal(strFromDecimal(position.notional), '12.758649608791536389');
              assert.equal(strFromDecimal(traderChange), '-0.427586496087915363');

              position = await vault.positionOf(pool.address, expiry, strike, true);
              assert.equal(strFromDecimal(position.size), '0.333333333333333333');
              assert.equal(strFromDecimal(position.notional), '-4.252883202930512125');
              assert.equal(strFromDecimal(poolChange), '0.14252883202930512');

              position = await vault.positionOf(pool2.address, expiry, strike, true);
              assert.equal(strFromDecimal(position.size), '0.333333333333333333');
              assert.equal(strFromDecimal(position.notional), '-4.252883202930512125');
              assert.equal(strFromDecimal(poolChange2), '0.14252883202930512');

              position = await vault.positionOf(pool3.address, expiry, strike, true);
              assert.equal(strFromDecimal(position.size), '0.333333333333333335');
              assert.equal(strFromDecimal(position.notional), '-4.252883202930512139');
              assert.equal(strFromDecimal(poolChange3), '0.142528832029305123');
            });
          });

          context('when size is 0.000000000000000002 and pool3 is small', () => {
            let vault, config, usdc;

            before(async () => {
              ({ vault, config, usdc } = await subSetup2());
              await vault.connect(pool3).withdraw(toDecimalStr('1999.999999999999999998'));
              await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr('0.000000000000000002'), INT_MAX]);
            });

            it('should have position"', async () => {
              let position = await vault.positionOf(trader.address, expiry, strike, true);
              assert.equal(strFromDecimal(position.size), '0.000000000000000002');

              position = await vault.positionOf(pool.address, expiry, strike, true);
              assert.equal(strFromDecimal(position.size), '-0.000000000000000001');

              position = await vault.positionOf(pool2.address, expiry, strike, true);
              assert.equal(strFromDecimal(position.size), '-0.000000000000000001');

              position = await vault.positionOf(pool3.address, expiry, strike, true);
              assert.equal(strFromDecimal(position.size), '0');
            });
          });
        });

        context('when pool2 available 0.000000000000000001', () => {
          let vault, config, usdc;

          before(async () => {
            ({ vault, config, usdc } = await subSetup());
            await addPool(config, pool);
            await addPool(config, pool2);
            await addPool(config, pool3);
            await mintAndDeposit(vault, usdc, pool, { mint: 10000000 });
            await mintAndDeposit(vault, usdc, pool2, { mint: 10000000, amount: '0.000001' });
            await mintAndDeposit(vault, usdc, pool3, { mint: 10000000 });
            await mintAndDeposit(vault, usdc, trader, { mint: 10000000 });
            await vault.connect(pool2).withdraw(toDecimalStr('0.000000999999999999'));
            await vault.connect(trader).trade([expiry, strike, 1, toDecimalStr('-1'), 0]);
          });

          it('should pool2 have no position"', async () => {
            position = await vault.positionOf(pool2.address, expiry, strike, true);
            assert.equal(strFromDecimal(position.size), '0');
          });
        });
      });
    });
  });
});
