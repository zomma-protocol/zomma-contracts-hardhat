const assert = require('assert');
const { signData, withSignedData, ivsToPrices, getSigners, getContractFactories, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, watchBalance, addPool, mintAndDeposit, INT_MAX, expectRevertCustom } = require('../../support/helper');

let Vault, Config, OptionMarket, TestERC20, SpotPricer, accounts;
describe('SignedVault', () => {
  let stakeholderAccount, insuranceAccount, trader, trader2, pool, pool2, pool3;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer, signatureValidator;

  const createVault = async (configAddress, optionMarketAddress) => {
    const vault = await Vault.deploy();
    await vault.initialize(configAddress, spotPricer.address, optionPricer.address, optionMarketAddress, signatureValidator.address);
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
    await vault.setTimestamp(now);
    return { vault, config, usdc, optionMarket };
  };

  const createSignedData = async ({
    spot = toDecimalStr(1000),
    ivs = [[expiry, strike, true, true, toDecimalStr(0.8), false], [expiry, strike, true, false, toDecimalStr(0.8), false]],
    expired = Math.floor(Date.now() / 1000) + 120,
    nowTime = now,
    isTrade = false
  } = {}) => {
    return await signData(signatureValidator.address, stakeholderAccount, ivsToPrices(ivs, spot, nowTime), spot, expired, isTrade);
  };

  before(async () => {
    [Vault, Config, OptionMarket, TestERC20, SpotPricer] = await getContractFactories('TestSignedVault', 'Config', 'TestOptionMarket', 'TestERC20', 'TestSpotPricer');
    accounts = await getSigners();
    [stakeholderAccount, insuranceAccount, trader, trader2, pool, pool2, pool3] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer('SignedOptionPricer');
    signatureValidator = await createSignatureValidator();
  });

  describe('#trade', () => {
    let vault, config, usdc, optionMarket, signedData;
    let tradeData = { isTrade: true };

    const subSetup = async () => {
      ({ vault, config, usdc, optionMarket } = await setup());
      const signedData = await createSignedData();
      return { vault, config, usdc, optionMarket, signedData };
    };

    const reset = async () => {
      await withSignedData(vault.connect(trader), signedData).withdrawPercent(toDecimalStr(1), 0, 0);
      await vault.connect(trader).deposit(toDecimalStr(1000));
      await withSignedData(vault.connect(pool), signedData).withdrawPercent(toDecimalStr(1), 0, 0);
      await vault.connect(pool).deposit(toDecimalStr(1000));
    };

    before(async () => {
      ({ vault, config, usdc, signedData } = await subSetup());
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
        await expectRevertCustom(withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX], now), Vault, 'TradeDisabled');
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
        await expectRevertCustom(withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX], now), Vault, 'TradeDisabled');
      });
    });

    context('when marketDisabled is true', () => {
      let signedData;

      context('when disable buy', () => {
        let ivs = [[expiry, strike, true, true, toDecimalStr(0.8), true]];
        let tradeData = { ivs, isTrade: true };

        beforeEach(async () => {
          signedData = await createSignedData({ ivs });
        });

        it('should revert with TradeDisabled', async () => {
          await expectRevertCustom(withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX], now), Vault, 'TradeDisabled');
        });
      });

      context('when disable sell', () => {
        let ivs = [[expiry, strike, true, false, toDecimalStr(0.8), true]];
        let tradeData = { ivs, isTrade: true };

        beforeEach(async () => {
          signedData = await createSignedData({ ivs });
        });

        it('should revert with TradeDisabled', async () => {
          await expectRevertCustom(withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(-1), 0], now), Vault, 'TradeDisabled');
        });
      });
    });

    context('when not disabled', () => {
      context('when 7 days to expire', () => {
        context('when pool available 1000', () => {
          context('when size is 0', () => {
            it('should revert with InvalidSize', async () => {
              await expectRevertCustom(withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(0), INT_MAX], now), Vault, 'InvalidSize');
            });
          });

          context('when size is 1', () => {
            context('when trader not available', () => {
              it('should revert with Unavailable', async () => {
                await expectRevertCustom(withSignedData(vault.connect(trader2), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX], now), Vault, 'Unavailable');
              });
            });

            context('when acceptableTotal is 13.256648796875263155', () => {
              it('should revert with UnacceptablePrice', async () => {
                await expectRevertCustom(withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(1), toDecimalStr('13.256648796875263155')], now), Vault, 'UnacceptablePrice');
              });
            });

            context('when missing iv', () => {
              it('should revert with InvalidMarket', async () => {
                const signedData = await createSignedData({ ivs: [], isTrade: true });
                await expectRevertCustom(withSignedData(vault.connect(trader), signedData).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX], now), Vault, 'InvalidMarket');
              });
            });

            context('when nonce is 0', () => {
              it('should revert with InvalidNonce', async () => {
                await expectRevertCustom(withSignedData(vault.connect(trader), await createSignedData()).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX], now), Vault, 'InvalidNonce');
              });
            });

            context('when acceptableTotal is 13.256648796875263156', () => {
              const acceptableTotal = toDecimalStr('13.256648796875263156');

              context('when reusing signature', () => {
                let signedData;
                let tradeData = { isTrade: true };

                before(async () => {
                  signedData = await createSignedData(tradeData);
                  await withSignedData(vault.connect(trader), signedData).trade([expiry, strike, 1, toDecimalStr(1), acceptableTotal], now);
                });

                after(async () => {
                  await reset();
                });

                it('should revert with UsedNonce', async () => {
                  await expectRevertCustom(withSignedData(vault.connect(trader), signedData).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX], now), signatureValidator, 'UsedNonce');
                });
              });

              context('when poolProportion is 1', () => {
                let traderChange, poolChange, traderPosition, poolPosition;
                const ivs = [
                  [expiry, strike, true, true, toDecimalStr(0.8), false],
                  [expiry, strike, true, false, toDecimalStr(0.8), true]
                ];
                let tradeData = { ivs, isTrade: true };

                before(async () => {
                  [traderChange, poolChange] = await watchBalance(vault, [trader.address, pool.address], async () => {
                    await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(1), acceptableTotal], now);
                  });
                  traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
                  poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
                  await reset();
                });

                // fee: 0.428283651454210526
                it('should be trader size 1', async () => {
                  assert.equal(strFromDecimal(traderPosition.size), '1');
                });

                it('should be trader notional -12.82836514542105263', async () => {
                  assert.equal(strFromDecimal(traderPosition.notional), '-12.82836514542105263');
                });

                it('should be pool size -1', async () => {
                  assert.equal(strFromDecimal(poolPosition.size), '-1');
                });

                it('should be pool notional 12.82836514542105263', async () => {
                  assert.equal(strFromDecimal(poolPosition.notional), '12.82836514542105263');
                });

                it('should change trader balance -0.428283651454210526', async () => {
                  assert.equal(strFromDecimal(traderChange), '-0.428283651454210526');
                });

                it('should change pool balance 0.428283651454210526', async () => {
                  assert.equal(strFromDecimal(poolChange), '0.428283651454210526');
                });
              });

              context('when poolProportion is 0.3', () => {
                context('when insuranceProportion is 1', () => {
                  let poolChange, insuranceAccountChange, stakeholderAccountChange;

                  before(async () => {
                    await config.setPoolProportion(toDecimalStr(0.3));
                    await config.setInsuranceProportion(toDecimalStr(1));
                    [poolChange, insuranceAccountChange, stakeholderAccountChange] = await watchBalance(vault, [pool.address, insuranceAccount.address, stakeholderAccount.address], async () => {
                      await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(1), acceptableTotal], now);
                    });
                    await config.setPoolProportion(toDecimalStr(1));
                    await config.setInsuranceProportion(toDecimalStr(0.3));
                    await reset();
                  });

                  // fee: 0.428283651454210526
                  it('should change pool balance 0.128485095436263157', async () => {
                    assert.equal(strFromDecimal(poolChange), '0.128485095436263157');
                  });

                  it('should change insurance Account balance 0.299798556017947369', async () => {
                    assert.equal(strFromDecimal(insuranceAccountChange), '0.299798556017947369');
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
                      await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(1), acceptableTotal], now);
                    });
                    await config.setPoolProportion(toDecimalStr(1));
                    await reset();
                  });

                  // fee: 0.428283651454210526
                  it('should change pool balance 0.128485095436263157', async () => {
                    assert.equal(strFromDecimal(poolChange), '0.128485095436263157');
                  });

                  // 0.299798556017947369 * 0.3
                  it('should change insurance Account balance 0.08993956680538421', async () => {
                    assert.equal(strFromDecimal(insuranceAccountChange), '0.08993956680538421');
                  });

                  it('should change insurance Account balance 0.209858989212563159', async () => {
                    assert.equal(strFromDecimal(stakeholderAccountChange), '0.209858989212563159');
                  });
                });
              });
            });

            context('when spot 500, minPremium 0 and fee 0', () => {
              let signedData;
              let tradeData = { spot: toDecimalStr(500), isTrade: true };

              beforeEach(async () => {
                await config.setMinPremium(toDecimalStr(0));
                await config.setSpotFee(toDecimalStr(0));
              });

              afterEach(async () => {
                await config.setMinPremium(toDecimalStr(1));
                await config.setSpotFee(toDecimalStr(0.0003));
              });

              it('should revert with ZeroPrice', async () => {
                await expectRevertCustom(withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX], now), Vault, 'ZeroPrice');
              });
            });

            context('when then other no balance account size -1', () => {
              before(async () => {
                await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(1), INT_MAX], now);
              });

              after(async () => {
                await reset();
              });

              it('should revert with Unavailable', async () => {
                await expectRevertCustom(withSignedData(vault.connect(pool3), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(-1), 0], now), Vault, 'Unavailable');
              });
            });
          });

          context('when size is -1', () => {
            context('when open only', () => {
              context('when acceptableTotal is 12.325109365048915062', () => {
                it('should revert with UnacceptablePrice', async () => {
                  await expectRevertCustom(withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(-1), toDecimalStr('12.325109365048915062')], now), Vault, 'UnacceptablePrice');
                });
              });

              context('when acceptableTotal is 12.325109365048915061', () => {
                let traderChange, poolChange, traderPosition, poolPosition, signedData;
                const ivs = [
                  [expiry, strike, true, true, toDecimalStr(0.8), true],
                  [expiry, strike, true, false, toDecimalStr(0.8), false]
                ];
                let tradeData = { ivs, isTrade: true };

                before(async () => {
                  [traderChange, poolChange] = await watchBalance(vault, [trader.address, pool.address], async () => {
                    await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(-1), toDecimalStr('12.325109365048915061')], now);
                  });
                  traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
                  poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
                  await reset();
                });

                // fee: 0.427526357222716313
                it('should be trader size -1', async () => {
                  assert.equal(strFromDecimal(traderPosition.size), '-1');
                });

                it('should be trader notional 12.752635722271631374', async () => {
                  assert.equal(strFromDecimal(traderPosition.notional), '12.752635722271631374');
                });

                it('should be pool size 1', async () => {
                  assert.equal(strFromDecimal(poolPosition.size), '1');
                });

                it('should be pool notional -12.752635722271631374', async () => {
                  assert.equal(strFromDecimal(poolPosition.notional), '-12.752635722271631374');
                });

                it('should change trader balance -0.427526357222716313', async () => {
                  assert.equal(strFromDecimal(traderChange), '-0.427526357222716313');
                });

                it('should change pool balance 0.427526357222716313', async () => {
                  assert.equal(strFromDecimal(poolChange), '0.427526357222716313');
                });
              });

              context('when spot 500', () => {
                let signedData;

                beforeEach(async () => {
                  signedData = await createSignedData({ spot: toDecimalStr(500), isTrade: true });
                });

                it('should revert with ZeroPrice', async () => {
                  await expectRevertCustom(withSignedData(vault.connect(trader), signedData).trade([expiry, strike, 1, toDecimalStr(-1), 0], now), Vault, 'ZeroPrice');
                });
              });
            });

            context('when then size 2', () => {
              let traderChange, poolChange, traderPosition, poolPosition;

              before(async () => {
                await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(-1), 0], now);
                [traderChange, poolChange] = await watchBalance(vault, [trader.address, pool.address], async () => {
                  await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(2), INT_MAX], now);
                });
                traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
                poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
                await reset();
              });

              // closePremium: -12.76120093
              // closeFee: -0.4276120093
              // premium: -12.828307185508315481
              // fee: -0.428283071855083154

              // trader
              // before notional: 12.752635722271631374
              // total premium: -25.589508115508315481
              // total fee: -0.855895081155083154
              // realized: -0.042118335482526366
              // notional = 12.752635722271631374 + -25.589508115508315481 - -0.042118335482526366

              // pool
              // close
              // realized: 0.008565207728368626
              // open
              // notional = premium = 12.828307185508315481

              it('should be trader size 1', async () => {
                assert.equal(strFromDecimal(traderPosition.size), '1');
              });

              it('should be trader notional -12.794754057754157741', async () => {
                assert.equal(strFromDecimal(traderPosition.notional), '-12.794754057754157741');
              });

              it('should be pool size -1', async () => {
                assert.equal(strFromDecimal(poolPosition.size), '-1');
              });

              it('should be pool notional 12.828307185508315481', async () => {
                assert.equal(strFromDecimal(poolPosition.notional), '12.828307185508315481');
              });

              // realized + total fee
              it('should change trader balance -0.89801341663760952', async () => {
                assert.equal(strFromDecimal(traderChange), '-0.89801341663760952');
              });

              // realized + total fee
              it('should change pool balance 0.86446028888345178', async () => {
                assert.equal(strFromDecimal(poolChange), '0.86446028888345178');
              });
            });

            context('when hf < 1', () => {
              context('when then size 0.1', () => {
                let accountInfoBefore, accountInfoAfter, signedData2;

                before(async () => {
                  await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(-1), 0], now);
                  signedData2 = await createSignedData({ spot: toDecimalStr(1950) });
                  accountInfoBefore = await withSignedData(vault, signedData2).getAccountInfo(trader.address);
                  await withSignedData(vault.connect(trader), await createSignedData({ spot: toDecimalStr(1950), isTrade: true })).trade([expiry, strike, 1, toDecimalStr(0.1), INT_MAX], now);
                  accountInfoAfter = await withSignedData(vault, signedData2).getAccountInfo(trader.address);
                  await reset();
                });

                it('should increase healthFactor', async () => {
                  assert.equal(accountInfoAfter.healthFactor.gt(accountInfoBefore.healthFactor), true);
                });
              });
            });
          });

          context('when size is 20', () => {
            it('should revert with PoolUnavailable', async () => {
              await expectRevertCustom(withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(20), INT_MAX], now), Vault, 'PoolUnavailable');
            });
          });
        });
      });
    });
  });
});
