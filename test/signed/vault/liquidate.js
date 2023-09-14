const assert = require('assert');
const { signData, withSignedData, ivsToPrices, getContractFactories, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, watchBalance, addPool, mintAndDeposit, INT_MAX, expectRevertCustom } = require('../../support/helper');

let Vault, Config, OptionMarket, TestERC20, SpotPricer, accounts;
describe('SignedVault', () => {
  let stakeholderAccount, insuranceAccount, trader, pool, liquidator, otherAccount;
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
    nonce = 0
  } = {}) => {
    if (typeof nonce === 'string') {
      nonce = await signatureValidator.nonces(nonce);
    }
    return await signData(signatureValidator.address, stakeholderAccount, ivsToPrices(ivs, spot, nowTime), spot, expired, nonce);
  };

  before(async () => {
    [Vault, Config, OptionMarket, TestERC20, SpotPricer] = await getContractFactories('TestSignedVault', 'Config', 'TestOptionMarket', 'TestERC20', 'TestSpotPricer');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader, pool, liquidator, otherAccount] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer('SignedOptionPricer');
    signatureValidator = await createSignatureValidator();
  });

  describe('#liquidate', () => {
    let vault, config, usdc, optionMarket, signedData;
    const strike2 = toDecimalStr(1200);
    const ivs = [
      [expiry, strike, true, true, toDecimalStr(0.8), false],
      [expiry, strike, true, false, toDecimalStr(0.8), false],
      [expiry, strike, false, true, toDecimalStr(0.8), false],
      [expiry, strike, false, false, toDecimalStr(0.8), false],
      [expiry, strike2, true, true, toDecimalStr(0.8), false],
      [expiry, strike2, true, false, toDecimalStr(0.8), false]
    ];

    const subSetup = async () => {
      ({ vault, config, usdc, optionMarket } = await setup());
      const signedData = await createSignedData({ ivs });
      const tradeData = { ivs, nonce: vault.address };
      await addPool(config, pool);
      await mintAndDeposit(vault, usdc, pool);
      await mintAndDeposit(vault, usdc, trader);
      await mintAndDeposit(vault, usdc, liquidator);
      await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(-7), 0], now);
      await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike2, 1, toDecimalStr('-0.000000000000000001'), 0], now);
      await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 0, toDecimalStr(1), INT_MAX], now);
      return { vault, config, usdc, optionMarket, signedData };
    };

    before(async () => {
      ({ vault, config, usdc, optionMarket, signedData } = await subSetup());
    });

    context('when expired', () => {
      let signedData;

      before(async () => {
        signedData = await createSignedData({ ivs, nowTime: expiry });
        await vault.setTimestamp(expiry);
      });

      after(async () => {
        await vault.setTimestamp(now);
      });

      it('should revert with InvalidTime', async () => {
        await expectRevertCustom(withSignedData(vault.connect(liquidator), signedData).liquidate(trader.address, expiry, strike, true, toDecimalStr(7)), Vault, 'InvalidTime');
      });
    });

    context('when not expired', () => {
      context('when position size 0', () => {
        it('should revert with ZeroPosition', async () => {
          await expectRevertCustom(withSignedData(vault.connect(liquidator), signedData).liquidate(trader.address, expiry, strike2, false, toDecimalStr(7)), Vault, 'ZeroPosition');
        });
      });

      context('when position size is not 0', () => {
        context('when healthFactor is 0.059422139602537861', () => {
          let signedData;

          before(async () => {
            signedData = await createSignedData({ ivs, spot: toDecimalStr(1220) });
          });

          context('when liquidator has no balance', () => {
            it('should revert with InsufficientEquity', async () => {
              await expectRevertCustom(withSignedData(vault.connect(liquidator), signedData).liquidate(trader.address, expiry, strike, true, toDecimalStr(7)), Vault, 'InsufficientEquity');
            });
          });
        });

        context('when healthFactor is 0.825124542401224941', () => {
          let signedData;
          const spot = toDecimalStr(1100);

          before(async () => {
            signedData = await createSignedData({ ivs, spot });
          });

          context('when liquidateRate is 0.825124542401224941', () => {
            before(async () => {
              await config.setLiquidateRate(toDecimalStr('0.825124542401224941'));
            });

            after(async () => {
              await config.setLiquidateRate(toDecimalStr('0.5'));
            });

            it('should revert with CannotLiquidate', async () => {
              await expectRevertCustom(withSignedData(vault.connect(liquidator), signedData).liquidate(trader.address, expiry, strike, true, toDecimalStr(1)), Vault, 'CannotLiquidate');
            });
          });

          context('when liquidateRate is 0.825124542401224942', () => {
            before(async () => {
              await config.setLiquidateRate(toDecimalStr('0.825124542401224942'));
            });

            after(async () => {
              await config.setLiquidateRate(toDecimalStr('0.5'));
            });

            context('when liquidate buy position', () => {
              context('when sell position exists', () => {
                let signedData;

                beforeEach(async () => {
                  await optionMarket.setTradeDisabled(true);
                  await optionMarket.setExpiryDisabled(expiry, true);
                  signedData = await createSignedData({ ivs: [...ivs, [expiry, strike2, true, true, toDecimalStr(0.8), true]], spot });
                });

                afterEach(async () => {
                  await optionMarket.setTradeDisabled(false);
                  await optionMarket.setExpiryDisabled(expiry, false);
                });

                it('should revert with SellPositionFirst', async () => {
                  await expectRevertCustom(withSignedData(vault.connect(liquidator), signedData).liquidate(trader.address, expiry, strike, false, toDecimalStr(1)), Vault, 'SellPositionFirst');
                });
              });

              context('when no sell position', () => {
                let vault, config, usdc, optionMarket;
                let traderBalanceChange, liquidatorBalanceChange, insuranceAccountBalanceChange, traderPosition, liquidatorPosition;

                before(async () => {
                  ({ vault, config, usdc, optionMarket } = await setup());
                  const tradeData = { ivs, spot: toDecimalStr(1000), nonce: vault.address };
                  await addPool(config, pool);
                  await mintAndDeposit(vault, usdc, pool, { amount: 10000 });
                  await mintAndDeposit(vault, usdc, trader);
                  await mintAndDeposit(vault, usdc, liquidator, { amount: 10000 });
                  await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 1, toDecimalStr(-6), 0], now);
                  await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike, 0, toDecimalStr('0.000000000000000001'), INT_MAX], now);
                  await withSignedData(vault.connect(trader), await createSignedData(tradeData)).trade([expiry, strike2, 1, toDecimalStr('6.000000000000000001'), INT_MAX], now);
                  await config.setLiquidateRate(toDecimalStr('0.825124542401224942'));
                  await optionMarket.setTradeDisabled(true);
                  await optionMarket.setExpiryDisabled(expiry, true);

                  const ivs2 = [
                    [expiry, strike, true, true, toDecimalStr(0.8), false],
                    [expiry, strike, true, false, toDecimalStr(0.8), false],
                    [expiry, strike, false, true, toDecimalStr(0.8), true],
                    [expiry, strike, false, false, toDecimalStr(0.8), false]
                  ];
                  const signedData3 = await createSignedData({ ivs: [...ivs, ...ivs2], spot: toDecimalStr(1200) });
                  await withSignedData(vault.connect(liquidator), signedData3).liquidate(trader.address, expiry, strike, true, toDecimalStr(6));
                  const signedData4 = await createSignedData({ ivs: [...ivs, ...ivs2], spot: toDecimalStr(1400) });
                  await withSignedData(vault.connect(liquidator), signedData4).liquidate(trader.address, expiry, strike, true, toDecimalStr(6));
                  const signedData5 = await createSignedData({ ivs: [...ivs, ...ivs2], spot: toDecimalStr(1300) });

                  // liquidate all
                  [traderBalanceChange, liquidatorBalanceChange, insuranceAccountBalanceChange] = await watchBalance(vault, [trader.address, liquidator.address, insuranceAccount.address], async () => {
                    await withSignedData(vault.connect(liquidator), signedData5).liquidate(trader.address, expiry, strike, false, toDecimalStr(1));
                  });
                  traderPosition = await vault.positionOf(trader.address, expiry, strike, false);
                  liquidatorPosition = await vault.positionOf(liquidator.address, expiry, strike, false);

                  await optionMarket.setTradeDisabled(false);
                  await optionMarket.setExpiryDisabled(expiry, false);
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
              });
            });
          });
        });
      });
    });
  });
});
