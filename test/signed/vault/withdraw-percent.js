const assert = require('assert');
const _ = require('lodash');
const { signData, withSignedData, ivsToPrices, getContractFactories, toDecimalStr, strFromDecimal, createOptionPricer, buildIv, mergeIv, watchBalance, addPool, mintAndDeposit, INT_MAX, toBigNumber, expectRevertCustom } = require('../../support/helper');

let Vault, Config, OptionMarket, TestERC20, SpotPricer, accounts;
describe('SignedVault', () => {
  let stakeholderAccount, insuranceAccount, trader, trader2, pool, otherAccount;
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
    await config.setInsuranceProportion(toDecimalStr(1));
    await optionMarket.initialize();
    await vault.setTimestamp(now);
    return { vault, config, usdc, optionMarket };
  };

  const createSignedData = async ({
    spot = toDecimalStr(1000),
    ivs = [[expiry, strike, true, true, toDecimalStr(0.8), false], [expiry, strike, true, false, toDecimalStr(0.8), false]],
    expired = Math.floor(Date.now() / 1000) + 120,
    nowTime = now
  } = {}) => {
    return await signData(stakeholderAccount, ivsToPrices(ivs, spot, nowTime), spot, expired);
  };

  before(async () => {
    [Vault, Config, OptionMarket, TestERC20, SpotPricer] = await getContractFactories('TestSignedVault', 'Config', 'TestOptionMarket', 'TestERC20', 'TestSpotPricer');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader, trader2, pool, otherAccount] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer('SignedOptionPricer');
  });

  describe('#withdrawPercent', () => {
    let vault, config, usdc, optionMarket, signedData;

    const subSetup = async () => {
      ({ vault, config, usdc, optionMarket } = await setup());
      signedData = await createSignedData();
      await addPool(config, pool);
      await mintAndDeposit(vault, usdc, pool, { mint: 10000000 });
      await mintAndDeposit(vault, usdc, trader, { mint: 10000000 });
      await mintAndDeposit(vault, usdc, trader2, { mint: 10000000 });
      return { vault, config, usdc };
    };

    const reset = async () => {
      await withSignedData(vault.connect(pool), signedData).withdrawPercent(toDecimalStr(1), 0, 0);
      await vault.connect(pool).deposit(toDecimalStr(1000));
    };

    const withdrawPercent = async (vault, usdc, account, {
      rate, freeWithdrawableRate, acceptableAmount = 0, reservedRate = 0, clear = true, vaultWatchBalance = [account.address], beforeClear = async () => {}
    }) => {
      if (reservedRate != 0) {
        await config.connect(account).setPoolReservedRate(reservedRate);
      }
      let walletChange;
      const vaultChanges = await watchBalance(vault, vaultWatchBalance, async () => {
        [walletChange] = await watchBalance(usdc, [account.address], async () => {
          await withSignedData(vault.connect(account), signedData).withdrawPercent(rate, acceptableAmount, freeWithdrawableRate);
        });
      });
      if (reservedRate != 0) {
        await config.connect(account).setPoolReservedRate(0);
      }
      await beforeClear();
      if (clear && strFromDecimal(await vault.balanceOf(account.address)) !== '0') {
        await withSignedData(vault.connect(account), signedData).withdrawPercent(toDecimalStr(1), 0, 0);
      }
      await vault.connect(account).deposit(toDecimalStr(1000));
      return { vaultChange: vaultChanges[0], walletChange, vaultChanges } ;
    };

    const traderWithdrawPercent = async (vault, usdc, account, expiry, strike, isCall, size, {
      rate, freeWithdrawableRate, acceptableAmount = 0, reservedRate = 0, clear = true, vaultWatchBalance = [account.address, insuranceAccount.address], includeAccountInfo = false, beforeClear = async () => {}
    }) => {
      await withSignedData(vault.connect(account), signedData).trade(expiry, strike, isCall, size, size > 0 ? INT_MAX : 0);
      let position, accountInfo, accountInfoBefore;
      if (includeAccountInfo) {
        accountInfoBefore = await withSignedData(vault, signedData).getAccountInfo(account.address);
      }
      const { vaultChanges, walletChange } = await withdrawPercent(vault, usdc, account, {
        rate, freeWithdrawableRate, reservedRate, acceptableAmount, vaultWatchBalance,
        beforeClear: async () => {
          position = await vault.positionOf(account.address, expiry, strike, isCall);
          if (includeAccountInfo) {
            accountInfo = await withSignedData(vault, signedData).getAccountInfo(account.address);
          }
          await beforeClear();
        }
      });
      const [vaultChange, insuranceAccountChange] = vaultChanges;
      await reset();
      return { vaultChange, insuranceAccountChange, walletChange, position, accountInfo, accountInfoBefore };
    }

    before(async () => {
      ({ vault, config, usdc } = await subSetup());
    });

    context('when no balance', () => {
      it('should revert with InsufficientEquity(0)', async () => {
        await expectRevertCustom(withSignedData(vault.connect(otherAccount), signedData).withdrawPercent(toDecimalStr(0.1), 0, toDecimalStr(0)), Vault, 'InsufficientEquity').withArgs(0);
      });
    });

    context('when balance', () => {
      context('when no position', () => {
        context('when freeWithdrawableRate is 1', () => {
          const freeWithdrawableRate = toDecimalStr(1);

          context('when rate is 1', () => {
            const rate = toDecimalStr(1);

            context('when reservedRate is 0', () => {
              const reservedRate = toDecimalStr(0);
              let vaultChange, walletChange;

              before(async () => {
                ({ vaultChange, walletChange } = await withdrawPercent(vault, usdc, trader2, { rate, freeWithdrawableRate, reservedRate }));
              });

              it('should change vault balance -1000', async () => {
                assert.equal(strFromDecimal(vaultChange), '-1000');
              });

              it('should change wallet balance 1000', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '1000');
              });
            });

            context('when reservedRate is 1', () => {
              const reservedRate = toDecimalStr(1);
              let vaultChange, walletChange;

              before(async () => {
                ({ vaultChange, walletChange } = await withdrawPercent(vault, usdc, trader2, { rate, freeWithdrawableRate, reservedRate }));
              });

              it('should change vault balance -1000', async () => {
                assert.equal(strFromDecimal(vaultChange), '-1000');
              });

              it('should change wallet balance 1000', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '1000');
              });
            });

            context('when reservedRate is 0.5', () => {
              const reservedRate = toDecimalStr(0.5);
              let vaultChange, walletChange;

              before(async () => {
                ({ vaultChange, walletChange } = await withdrawPercent(vault, usdc, trader2, { rate, freeWithdrawableRate, reservedRate }));
              });

              it('should change vault balance -1000', async () => {
                assert.equal(strFromDecimal(vaultChange), '-1000');
              });

              it('should change wallet balance 1000', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '1000');
              });
            });
          });

          context('when rate is 0.5', () => {
            const rate = toDecimalStr('0.5');

            context('when reservedRate is 0', () => {
              const reservedRate = toDecimalStr(0);
              let vaultChange, walletChange;

              before(async () => {
                ({ vaultChange, walletChange } = await withdrawPercent(vault, usdc, trader2, { rate, freeWithdrawableRate, reservedRate }));
              });

              it('should change vault balance -500', async () => {
                assert.equal(strFromDecimal(vaultChange), '-500');
              });

              it('should change wallet balance 500', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '500');
              });
            });

            context('when reservedRate is 1', () => {
              const reservedRate = toDecimalStr(1);
              let vaultChange, walletChange;

              before(async () => {
                ({ vaultChange, walletChange } = await withdrawPercent(vault, usdc, trader2, { rate, freeWithdrawableRate, reservedRate }));
              });

              it('should change vault balance -500', async () => {
                assert.equal(strFromDecimal(vaultChange), '-500');
              });

              it('should change wallet balance 500', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '500');
              });
            });

            context('when reservedRate is 0.5', () => {
              const reservedRate = toDecimalStr(0.5);
              let vaultChange, walletChange;

              before(async () => {
                ({ vaultChange, walletChange } = await withdrawPercent(vault, usdc, trader2, { rate, freeWithdrawableRate, reservedRate }));
              });

              it('should change vault balance -500', async () => {
                assert.equal(strFromDecimal(vaultChange), '-500');
              });

              it('should change wallet balance 500', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '500');
              });
            });
          });
        });

        context('when freeWithdrawableRate is 0', () => {
          const freeWithdrawableRate = toDecimalStr(0);

          context('when rate is 0', () => {
            const rate = toDecimalStr('0');

            it('should revert with InvalidRate', async () => {
              await expectRevertCustom(vault.connect(trader2).withdrawPercent(rate, 0, freeWithdrawableRate), Vault, 'InvalidRate');
            });
          });

          context('when rate is 1.000000000000000001', () => {
            const rate = toDecimalStr('1.000000000000000001');

            it('should revert with InvalidRate', async () => {
              await expectRevertCustom(vault.connect(trader2).withdrawPercent(rate, 0, freeWithdrawableRate), Vault, 'InvalidRate');
            });
          });

          context('when rate is 1', () => {
            const rate = toDecimalStr('1');
            let vaultChange, walletChange;

            before(async () => {
              ({ vaultChange, walletChange } = await withdrawPercent(vault, usdc, trader2, { rate, freeWithdrawableRate }));
            });

            it('should change vault balance -1000', async () => {
              assert.equal(strFromDecimal(vaultChange), '-1000');
            });

            it('should change wallet balance 1000', async () => {
              assert.equal(strFromDecimal(walletChange, 6), '1000');
            });
          });

          context('when rate is 0.000000001000000001', () => {
            const rate = toDecimalStr('0.000000001000000001');

            context('when acceptableAmount is 0.000001000000001001', () => {
              it('should revert with UnacceptableAmount', async () => {
                await expectRevertCustom(withSignedData(vault.connect(trader2), signedData).withdrawPercent(rate, toDecimalStr('0.000001000000001001'), freeWithdrawableRate), Vault, 'UnacceptableAmount');
              });
            });

            context('when acceptableAmount is 0.000001000000001', () => {
              let vaultChange, walletChange, insuranceAccountChange;

              before(async () => {
                ({ vaultChanges, walletChange } = await withdrawPercent(vault, usdc, trader2, {
                  rate, freeWithdrawableRate, acceptableAmount: toDecimalStr('0.000001000000001'), vaultWatchBalance: [trader2.address, insuranceAccount.address]
                }));
                [vaultChange, insuranceAccountChange] = vaultChanges;
              });

              it('should change vault balance -0.000001000000001', async () => {
                assert.equal(strFromDecimal(vaultChange), '-0.000001000000001');
              });

              it('should change wallet balance 0.000001', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '0.000001');
              });

              it('should change insurance account balance 0.000000000000001', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000000000001');
              });
            });
          });
        });

        context('when freeWithdrawableRate is 1.000000000000000001', () => {
          const freeWithdrawableRate = toDecimalStr('1.000000000000000001');
          const rate = toDecimalStr('1');

          it('should revert with InvalidFreeWithdrawableRate', async () => {
            await expectRevertCustom(vault.connect(trader2).withdrawPercent(rate, 0, freeWithdrawableRate), Vault, 'InvalidFreeWithdrawableRate');
          });
        });
      });

      context('when sell position', () => {
        context('when freeWithdrawableRate is 1', () => {
          const freeWithdrawableRate = toDecimalStr(1);

          context('when rate is 1', () => {
            const rate = toDecimalStr('1');

            context('when reservedRate is 0', () => {
              const reservedRate = toDecimalStr(0);

              context('when equity almost 0', () => {
                before(async () => {
                  await withSignedData(vault.connect(trader), signedData).trade(expiry, strike, true, toDecimalStr(-6), 0);
                  await withSignedData(vault.connect(trader2), signedData).trade(expiry, strike, true, toDecimalStr(6), INT_MAX);
                });

                after(async () => {
                  await withSignedData(vault.connect(trader), signedData).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(1));
                  await withSignedData(vault.connect(trader2), signedData).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(1));
                  await vault.connect(trader).deposit(toDecimalStr(1000));
                  await vault.connect(trader2).deposit(toDecimalStr(1000));
                  await reset();
                });

                it('should revert with ZeroAmount(3)', async () => {
                  const signedData = await createSignedData({ spot: toDecimalStr(1270) });
                  await expectRevertCustom(withSignedData(vault.connect(trader), signedData).withdrawPercent(rate, 0, freeWithdrawableRate), Vault, 'ZeroAmount').withArgs(3);
                });
              });

              context('when acceptableAmount is 997.358114251283689313', () => {
                before(async () => {
                  await withSignedData(vault.connect(trader), signedData).trade(expiry, strike, true, toDecimalStr(-3), 0);
                });

                after(async () => {
                  await withSignedData(vault.connect(trader), signedData).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(1));
                  await vault.connect(trader).deposit(toDecimalStr(1000));
                  await reset();
                });

                it('should revert with UnacceptableAmount', async () => {
                  await expectRevertCustom(withSignedData(vault.connect(trader), signedData).withdrawPercent(rate, toDecimalStr('997.358114251283689313'), freeWithdrawableRate), Vault, 'UnacceptableAmount');
                });
              });

              context('when acceptableAmount is 997.358114251283689312', () => {
                let vaultChange, walletChange, insuranceAccountChange, position;

                before(async () => {
                  ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                    vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                      rate, freeWithdrawableRate, reservedRate, acceptableAmount: toDecimalStr('997.358114251283689312')
                    }
                  ));
                });

                // balance: 998.717933807381982937

                // realized: -0.076983528198293625
                // fee: -1.2828360279
                // withdraw amount: 997.358114251283689312

                it('should change vault balance -998.717933807381982937', async () => {
                  assert.equal(strFromDecimal(vaultChange), '-998.717933807381982937');
                });

                it('should change wallet balance 997.358114', async () => {
                  assert.equal(strFromDecimal(walletChange, 6), '997.358114');
                });

                it('should change insurance account balance 0.000000251283689312', async () => {
                  assert.equal(strFromDecimal(insuranceAccountChange), '0.000000251283689312');
                });

                it('should be trader size 0', async () => {
                  assert.equal(strFromDecimal(position.size), '0');
                });

                it('should be trader notional 0', async () => {
                  assert.equal(strFromDecimal(position.notional), '0');
                });
              });
            });
          });
        });
      });

      context('when multiple positions', () => {
        const expiry2 = expiry + 86400;
        const s900_1 = toDecimalStr(900.1);
        const s1000 = toDecimalStr(1000);
        const s1100 = toDecimalStr(1100);
        const s1200 = toDecimalStr(1200);
        let balance, events;

        before(async () => {
          const ivs = [];
          [expiry, expiry2].forEach((e) => {
            [s900_1, s1000, s1100, s1200].forEach((s) => {
              ivs.push([e, s, true, true, toDecimalStr(0.8), false]);
              ivs.push([e, s, true, false, toDecimalStr(0.8), false]);
              ivs.push([e, s, false, true, toDecimalStr(0.8), false]);
              ivs.push([e, s, false, false, toDecimalStr(0.8), false]);
            });
          });
          signedData = await createSignedData({ ivs });
          await withSignedData(vault.connect(trader), signedData).trade(expiry, s1200, false, toDecimalStr(0.1), INT_MAX);
          await withSignedData(vault.connect(trader), signedData).trade(expiry, s1200, true, toDecimalStr(0.1), INT_MAX);
          await withSignedData(vault.connect(trader), signedData).trade(expiry2, s1200, false, toDecimalStr(0.1), INT_MAX);
          await withSignedData(vault.connect(trader), signedData).trade(expiry2, s1200, true, toDecimalStr(0.1), INT_MAX);
          for (const e of [expiry2, expiry]) {
            for (const s of [s900_1, s1000, s1100]) {
              await withSignedData(vault.connect(trader), signedData).trade(e, s, true, toDecimalStr(-0.1), 0);
              await withSignedData(vault.connect(trader), signedData).trade(e, s, false, toDecimalStr(-0.1), 0);
            }
          }
          const result = await (await withSignedData(vault.connect(trader), signedData).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(0))).wait();
          events = result.events.filter((e) => e.name === 'PositionUpdate');
          balance = await vault.balanceOf(trader.address);
          await vault.connect(trader).deposit(toDecimalStr(1000));
          await reset();
        });

        it('should remove order by otm, expiry, S-K', async () => {
          const order = events.map((event) => {
            return [event.args.expiry, strFromDecimal(event.args.strike), event.args.isCall].join('_');
          });

          const expect = [
            // sell
            // otm
            [expiry, s1100, true],
            [expiry, s900_1, false],
            [expiry2, s1100, true],
            [expiry2, s900_1, false],

            // expiry
            [expiry, s1000, false],
            [expiry, s1000, true],
            [expiry, s900_1, true],
            [expiry, s1100, false],

            // S-K
            [expiry2, s1000, false],
            [expiry2, s1000, true],
            [expiry2, s900_1, true],
            [expiry2, s1100, false],

            // buy won't sort
            [expiry, s1200, false],
            [expiry, s1200, true],
            [expiry2, s1200, false],
            [expiry2, s1200, true]
          ].map((market) => {
            market[1] =  strFromDecimal(market[1]);
            return market.join('_');
          });

          assert.equal(_.uniq(order).join('\n'), expect.join('\n'));
        });

        it('should be clear', async () => {
          assert.equal(strFromDecimal(balance), '0');
        });
      });
    });
  });
});
