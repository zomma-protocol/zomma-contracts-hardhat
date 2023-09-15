const assert = require('assert');
const { signData, signTrade, withSignedData, ivsToPrices, getContractFactories, expectRevertCustom, expectRevertWithoutReason, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, watchBalance, addPool, mintAndDeposit, INT_MAX } = require('../support/helper');

let Vault, Config, TestERC20, SpotPricer, OptionMarket, accounts;
describe('SignedVault', () => {
  let stakeholderAccount, insuranceAccount, trader, trader2, pool, settler, liquidator, otherAccount, otherAccount2, pool2;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer, vault, config, usdc, optionMarket, signatureValidator;

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
    await optionMarket.initialize();
    await vault.setTimestamp(now);
    return { vault, config, usdc, optionMarket };
  };

  const tradeBySignature = async (vault, signer, data, deadline, gasFee, signedData = null) => {
    if (!signedData) {
      signedData = await createSignedData();
    }
    return withSignedData(vault, signedData).tradeBySignature(...(await signTrade(signatureValidator, signer, data, deadline, gasFee)))
  };

  const createSignedData = async ({
    spot = toDecimalStr(1000),
    ivs = [[expiry, strike, true, true, toDecimalStr(0.8), false], [expiry, strike, true, false, toDecimalStr(0.8), false]],
    expired = Math.floor(Date.now() / 1000) + 120,
    nowTime = now
  } = {}) => {
    return await signData(signatureValidator.address, stakeholderAccount, ivsToPrices(ivs, spot, nowTime), spot, expired);
  };

  before(async () => {
    [Vault, Config, TestERC20, SpotPricer, OptionMarket] = await getContractFactories('TestSignedVault', 'Config', 'TestERC20', 'TestSpotPricer', 'OptionMarket');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader, trader2, pool, settler, liquidator, otherAccount, otherAccount2, pool2] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer('SignedOptionPricer');
    signatureValidator = await createSignatureValidator();
    ({ vault, config, usdc, optionMarket } = await setup());
  });

  describe('#withdraw', () => {
    let vault, config, usdc, signedData;

    before(async () => {
      ({ vault, config, usdc } = await setup());
      signedData = await createSignedData();
    });

    context('when available 1000', () => {
      context('when normal account', () => {
        before(async () => {
          await mintAndDeposit(vault, usdc, trader);
        });

        context('when withdraw 0', () => {
          it('should revert with ZeroAmount', async () => {
            await expectRevertCustom(withSignedData(vault, signedData).withdraw(0), Vault, 'ZeroAmount');
          });
        });

        context('when withdraw 1', () => {
          let tvlChange, insuranceChange;

          context('when signed', () => {
            before(async () => {
              [insuranceChange] = await watchBalance(vault, [insuranceAccount.address], async () => {
                [tvlChange] = await watchBalance(usdc, [vault.address], async () => {
                  await withSignedData(vault.connect(trader), signedData).withdraw(toDecimalStr(1));
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

          context('when not signed', () => {
            it('should revert without reason', async () => {
              await expectRevertWithoutReason(vault.connect(trader).withdraw(toDecimalStr(1)));
            });
          });

          context('when signature expired', () => {
            it('should revert with SignatureExpired()', async () => {
              const signedData = await createSignedData({ expired: now - 1 });
              await expectRevertCustom(withSignedData(vault.connect(trader), signedData).withdraw(toDecimalStr(1)), Vault, 'SignatureExpired');
            });
          });

          context('when invalid signer', () => {
            it('should revert with InvalidSignature()', async () => {
              const signedData = await signData(signatureValidator.address, trader, [], toDecimalStr(1000), now);
              await expectRevertCustom(withSignedData(vault.connect(trader), signedData).withdraw(toDecimalStr(1)), signatureValidator, 'InvalidSignature');
            });
          });

          context('when alert signature', () => {
            it('should revert with InvalidSignature()', async () => {
              const signedData2 = signedData.replace('3635c9adc5dea', '4635c9adc5dea');
              await expectRevertCustom(withSignedData(vault.connect(trader), signedData2).withdraw(toDecimalStr(1)), signatureValidator, 'InvalidSignature');
            });
          });
        });

        context('when withdraw 1.0000001', () => {
          context('when insuranceProportion is 0.3', () => {
            let tvlChange, insuranceChange;

            before(async () => {
              await mintAndDeposit(vault, usdc, trader2);
              [insuranceChange] = await watchBalance(vault, [insuranceAccount.address], async () => {
                [tvlChange] = await watchBalance(usdc, [vault.address], async () => {
                  await withSignedData(vault.connect(trader2), signedData).withdraw(toDecimalStr('1.0000001'));
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
                  await withSignedData(vault.connect(otherAccount2), signedData).withdraw(toDecimalStr('1.0000001'));
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
                await withSignedData(vault.connect(otherAccount), signedData).withdraw(toDecimalStr('1001.0000001'));
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
              await withSignedData(vault.connect(insuranceAccount), signedData).withdraw(toDecimalStr('1.0000001'));
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
      let vault, config, usdc, optionMarket, signedData;

      before(async () => {
        ({ vault, config, usdc, optionMarket } = await setup());
        await vault.setTimestamp(now);
        await addPool(config, pool);
        await mintAndDeposit(vault, usdc, pool);
        await mintAndDeposit(vault, usdc, accounts[5]);
        await tradeBySignature(vault, accounts[5], [expiry, strike, 1, toDecimalStr(-8), 0], now, 0);
        signedData = await createSignedData({ spot: toDecimalStr(1300) });
      });

      context('when withdraw 1', () => {
        it('should revert with ZeroAmount2', async () => {
          await expectRevertCustom(withSignedData(vault.connect(accounts[5]), signedData).withdraw(1), Vault, 'ZeroAmount2');
        });
      });
    });
  });

  describe('#clear', () => {
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
      await config.setPoolProportion(toDecimalStr(1));
      signedData = await createSignedData({ ivs });
      await addPool(config, pool);
      await mintAndDeposit(vault, usdc, pool);
      await mintAndDeposit(vault, usdc, trader);
      await mintAndDeposit(vault, usdc, liquidator);
      await tradeBySignature(vault, trader, [expiry, strike, 1, toDecimalStr(-7), 0], now, 0, await createSignedData({ ivs }));
      await tradeBySignature(vault, trader, [expiry, strike2, 1, toDecimalStr('-0.000000000000000001'), 0], now, 0, await createSignedData({ ivs }));
      await tradeBySignature(vault, trader, [expiry, strike, 0, toDecimalStr(1), INT_MAX], now, 0,await createSignedData({ ivs }));
      return { vault, config, usdc };
    }

    before(async () => {
      ({ vault, config, usdc } = await subSetup());
    });

    context('when insurance account', () => {
      context('when liquidator has no balance', () => {
        it('should revert with InvalidAccount', async () => {
          await expectRevertCustom(withSignedData(vault.connect(liquidator), signedData).clear(insuranceAccount.address), Vault, 'InvalidAccount');
        });
      });
    });

    context('when healthFactor is 0.825124542401224941', () => {
      const spot = toDecimalStr(1100);
      let signedData;

      before(async () => {
        signedData = await createSignedData({ ivs, spot });
      });

      context('when clearRate is 0.825124542401224941', () => {
        before(async () => {
          await config.setLiquidateRate(toDecimalStr('1'));
          await config.setClearRate(toDecimalStr('0.825124542401224941'));
        });

        after(async () => {
          await config.setClearRate(toDecimalStr('0.2'));
          await config.setLiquidateRate(toDecimalStr('0.5'));
        });

        it('should revert with CannotClear', async () => {
          await expectRevertCustom(withSignedData(vault.connect(liquidator), signedData).clear(trader.address), Vault, 'CannotClear');
        });
      });

      context('when clearRate is 0.825124542401224942', () => {
        let insuranceAccountBalanceChange, traderPosition, traderPosition2, traderPosition3, insuranceAccountPosition, insuranceAccountPosition2, insuranceAccountPosition3;

        before(async () => {
          await config.setLiquidateRate(toDecimalStr('1'));
          await config.setClearRate(toDecimalStr('0.825124542401224942'));
          [insuranceAccountBalanceChange] = await watchBalance(vault, [insuranceAccount.address], async () => {
            await withSignedData(vault.connect(liquidator), signedData).clear(trader.address);
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

        // trader balance: 995.579637628503699898
        // notional: 88.910394726678458241, 0.000000000000000002, -113.125842422951552427

        it('should be trader balance 0', async () => {
          assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), '0');
        });

        it('should change insurance account balance 995.579637628503699898', async () => {
          assert.equal(strFromDecimal(insuranceAccountBalanceChange), '995.579637628503699898');
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

        it('should be insurance account notional 88.910394726678458241, 0.000000000000000002, -113.125842422951552427', async () => {
          assert.equal(strFromDecimal(insuranceAccountPosition.notional), '88.910394726678458241');
          assert.equal(strFromDecimal(insuranceAccountPosition2.notional), '0.000000000000000002');
          assert.equal(strFromDecimal(insuranceAccountPosition3.notional), '-113.125842422951552427');
        });
      });
    });

    context('when marginBalance < 0 and no positions', () => {
      let vault, config, usdc, signedData, insuranceAccountBalanceChange;

      before(async () => {
        ({ vault, config, usdc } = await subSetup());
        await vault.setTimestamp(expiry);
        signedData = await createSignedData({ ivs, spot: toDecimalStr(1250) });
        await spotPricer.setSettledPrice(expiry, toDecimalStr(1250));
        await vault.settle(trader.address, expiry);
        [insuranceAccountBalanceChange] = await watchBalance(vault, [insuranceAccount.address], async () => {
          await withSignedData(vault.connect(liquidator), signedData).clear(trader.address);
        });
      });

      // trader balance: -78.823310067769394341

      it('should be trader balance 0', async () => {
        assert.equal(strFromDecimal(await vault.balanceOf(trader.address)), '0');
      });

      it('should change insurance account balance -78.823310067769394341', async () => {
        assert.equal(strFromDecimal(insuranceAccountBalanceChange), '-78.823310067769394341');
      });
    });
  });
});
