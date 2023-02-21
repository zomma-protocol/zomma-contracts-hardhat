const assert = require('assert');
const _ = require('lodash');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal, createOptionPricer, buildIv, watchBalance, addPool, mintAndDeposit, INT_MAX, toBigNumber } = require('../support/helper');

let Vault, Config, TestERC20, SpotPricer, accounts;
describe('Vault', () => {
  let teamAccount, insuranceAccount, trader, trader2, pool, otherAccount;
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
    [teamAccount, insuranceAccount, trader, trader2, pool, otherAccount] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer(artifacts);
  });

  describe('#withdrawPercent', () => {
    let vault, config, usdc;

    const subSetup = async () => {
      ({ vault, config, usdc } = await setup());
      await setupMarket(vault);
      await addPool(config, pool);
      await mintAndDeposit(vault, usdc, pool, { mint: 10000000 });
      await mintAndDeposit(vault, usdc, trader, { mint: 10000000 });
      await mintAndDeposit(vault, usdc, trader2, { mint: 10000000 });
      return { vault, config, usdc };
    };

    const reset = async () => {
      await vault.connect(pool).withdrawPercent(toDecimalStr(1), 0, 0);
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
          await vault.connect(account).withdrawPercent(rate, acceptableAmount, freeWithdrawableRate);
        });
      });
      if (reservedRate != 0) {
        await config.connect(account).setPoolReservedRate(0);
      }
      await beforeClear();
      if (clear && strFromDecimal(await vault.balanceOf(account.address)) !== '0') {
        await vault.connect(account).withdrawPercent(toDecimalStr(1), 0, 0);
      }
      await vault.connect(account).deposit(toDecimalStr(1000));
      return { vaultChange: vaultChanges[0], walletChange, vaultChanges } ;
    };

    const traderWithdrawPercent = async (vault, usdc, account, expiry, strike, isCall, size, {
      rate, freeWithdrawableRate, acceptableAmount = 0, reservedRate = 0, clear = true, vaultWatchBalance = [account.address, insuranceAccount.address], includeAccountInfo = false, beforeClear = async () => {}
    }) => {
      await vault.connect(account).trade(expiry, strike, isCall, size, size > 0 ? INT_MAX : 0);
      let position, accountInfo, accountInfoBefore;
      if (includeAccountInfo) {
        accountInfoBefore = await vault.getAccountInfo(account.address);
      }
      const { vaultChanges, walletChange } = await withdrawPercent(vault, usdc, account, {
        rate, freeWithdrawableRate, reservedRate, acceptableAmount, vaultWatchBalance,
        beforeClear: async () => {
          position = await vault.positionOf(account.address, expiry, strike, isCall);
          if (includeAccountInfo) {
            accountInfo = await vault.getAccountInfo(account.address);
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
      it('should revert with "insufficient equity"', async () => {
        await expectRevert(vault.connect(otherAccount).withdrawPercent(toDecimalStr(0.1), 0, toDecimalStr(0)), 'insufficient equity');
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

            it('should revert with "invalid rate"', async () => {
              await expectRevert(vault.connect(trader2).withdrawPercent(rate, 0, freeWithdrawableRate), 'invalid rate');
            });
          });

          context('when rate is 1.000000000000000001', () => {
            const rate = toDecimalStr('1.000000000000000001');

            it('should revert with "invalid rate"', async () => {
              await expectRevert(vault.connect(trader2).withdrawPercent(rate, 0, freeWithdrawableRate), 'invalid rate');
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
              it('should revert with "unacceptable amount"', async () => {
                await expectRevert(vault.connect(trader2).withdrawPercent(rate, toDecimalStr('0.000001000000001001'), freeWithdrawableRate), 'unacceptable amount');
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

          it('should revert with "invalid freeWithdrawableRate"', async () => {
            await expectRevert(vault.connect(trader2).withdrawPercent(rate, 0, freeWithdrawableRate), 'invalid freeWithdrawableRate');
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
                  await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-6), 0);
                  await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(6), INT_MAX);
                  await spotPricer.setPrice(toDecimalStr(1270));
                });

                after(async () => {
                  await spotPricer.setPrice(toDecimalStr(1000));
                  await vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(1));
                  await vault.connect(trader2).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(1));
                  await vault.connect(trader).deposit(toDecimalStr(1000));
                  await vault.connect(trader2).deposit(toDecimalStr(1000));
                  await reset();
                });

                it('should revert with "amount is 0"', async () => {
                  await expectRevert(vault.connect(trader).withdrawPercent(rate, 0, freeWithdrawableRate), 'amount is 0');
                });
              });

              context('when acceptableAmount is 997.358143677255407654', () => {
                before(async () => {
                  await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-3), 0);
                });

                after(async () => {
                  await vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(1));
                  await vault.connect(trader).deposit(toDecimalStr(1000));
                  await reset();
                });

                it('should revert with "unacceptable amount"', async () => {
                  await expectRevert(vault.connect(trader).withdrawPercent(rate, toDecimalStr('997.358143677255407654'), freeWithdrawableRate), 'unacceptable amount');
                });
              });

              context('when acceptableAmount is 997.358143677255407653', () => {
                let vaultChange, walletChange, insuranceAccountChange, position;

                before(async () => {
                  ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                    vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                      rate, freeWithdrawableRate, reservedRate, acceptableAmount: toDecimalStr('997.358143677255407653')
                    }
                  ));
                });

                // equity: '998.640967432810720216',
                // available: '698.640967432810720216',
                // healthFactor: '3.328803224776035734'
                // balance: 998.717946030420788116

                // realized: -0.076978597610067900
                // fee: -1.282823755555312563
                // withdraw amount: 997.358143677255407653

                it('should change vault balance -998.717946030420788116', async () => {
                  assert.equal(strFromDecimal(vaultChange), '-998.717946030420788116');
                });

                it('should change wallet balance 997.358143', async () => {
                  assert.equal(strFromDecimal(walletChange, 6), '997.358143');
                });

                it('should change insurance account balance 0.000000677255407653', async () => {
                  assert.equal(strFromDecimal(insuranceAccountChange), '0.000000677255407653');
                });

                it('should be trader size 0', async () => {
                  assert.equal(strFromDecimal(position.size), '0');
                });

                it('should be trader notional 0', async () => {
                  assert.equal(strFromDecimal(position.notional), '0');
                });
              });
            });

            context('when reservedRate is 0.5', () => {
              const reservedRate = toDecimalStr(0.5);
              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              it('should change vault balance -998.717946030420788116', async () => {
                assert.equal(strFromDecimal(vaultChange), '-998.717946030420788116');
              });

              it('should change wallet balance 997.358143', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '997.358143');
              });

              it('should change insurance account balance 0.000000677255407653', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000677255407653');
              });

              it('should be trader size 0', async () => {
                assert.equal(strFromDecimal(position.size), '0');
              });

              it('should be trader notional 0', async () => {
                assert.equal(strFromDecimal(position.notional), '0');
              });
            });

            context('when reservedRate is 1', () => {
              const reservedRate = toDecimalStr(1);
              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              it('should change vault balance -998.717946030420788116', async () => {
                assert.equal(strFromDecimal(vaultChange), '-998.717946030420788116');
              });

              it('should change wallet balance 997.358143', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '997.358143');
              });

              it('should change insurance account balance 0.000000677255407653', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000677255407653');
              });

              it('should be trader size 0', async () => {
                assert.equal(strFromDecimal(position.size), '0');
              });

              it('should be trader notional 0', async () => {
                assert.equal(strFromDecimal(position.notional), '0');
              });
            });
          });

          context('when rate is 0.5', () => {
            const rate = toDecimalStr('0.5');

            context('when reservedRate is 0', () => {
              const reservedRate = toDecimalStr(0);
              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.640967432810720216',
              // available: '698.640967432810720216',
              // healthFactor: '3.328803224776035734'
              // balance: 998.717946030420788116

              // reservedRate: 0
              // reserved: 0
              // adjustedAvailable: 698.640967432810720216
              // adjustedEquity: 998.640967432810720216

              // freeWithdrawableRate: 1
              // maxFreeWithdrawableAmount: 698.640967432810720216
              // expectToWithdrawAmount: 499.320483716405360108
              // won't remove position

              it('should change vault balance -499.320483716405360108', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.320483716405360108');
              });

              it('should change wallet balance 499.320483', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.320483');
              });

              it('should change insurance account balance 0.000000716405360108', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000716405360108');
              });

              it('should be trader size -3', async () => {
                assert.equal(strFromDecimal(position.size), '-3');
              });
            });

            context('when reservedRate is 0.5', () => {
              const reservedRate = toDecimalStr(0.5);
              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.640967432810720216',
              // available: '698.640967432810720216',
              // healthFactor: '3.328803224776035734'
              // balance: 998.717946030420788116

              // reservedRate: 0.5
              // reserved: 518.461671494170988279
              // adjustedAvailable: 180.179295938639731937
              // adjustedEquity: 480.179295938639731937

              // freeWithdrawableRate: 1
              // maxFreeWithdrawableAmount1: 180.179295938639731937
              // maxFreeWithdrawableAmount2: 180.179295938639731937 / 0.5 = 360.358591877279463874
              // expectToWithdrawAmount: 499.320483716405360108

              // equity after free: 998.640967432810720216 - 360.358591877279463874 = 638.282375555531256342
              // remain to remove: 499.320483716405360108 - 360.358591877279463874 = 138.961891839125896234
              // remove rate: 138.961891839125896234 / 638.282375555531256342 = 0.217712249563807769
              // expectedRemainEquity: equity after free - remain to remove = 499.320483716405360108

              // realized: -0.016759183653955038
              // fee: -0.279286445615839341
              // equity after remove position: 998.361680987194880876
              // withdraw amount: equity after remove position - expectedRemainEquity
              //                  = 998.361680987194880876 - 499.320483716405360108 = 499.041197270789520768

              // -withdraw amount + realized + fee
              it('should change vault balance -499.337242900059315147', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.337242900059315147');
              });

              it('should change wallet balance 499.041197', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.041197');
              });

              it('should change insurance account balance 0.000000270789520769', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000270789520768');
              });

              // remove size: 3 * 0.217712249563807769 = 0.653136748691423307
              it('should be trader size -2.346863251308576693', async () => {
                assert.equal(strFromDecimal(position.size), '-2.346863251308576693');
              });
            });

            context('when reservedRate is 1', () => {
              const reservedRate = toDecimalStr(1);
              let vaultChange, walletChange, insuranceAccountChange, position, accountInfo;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position, accountInfo } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                    rate, freeWithdrawableRate, reservedRate, includeAccountInfo: true
                  }
                ));
              });

              // equity: '998.640967432810720216',
              // available: '698.640967432810720216',
              // healthFactor: '3.328803224776035734'
              // balance: 998.717946030420788116

              // reservedRate: 1
              // reserved: 1036.923342988341976558
              // adjustedAvailable: -xx
              // adjustedEquity: -xx

              // freeWithdrawableRate: 1
              // maxFreeWithdrawableAmount: 0
              // expectToWithdrawAmount: 499.320483716405360108

              // equity after free: 998.640967432810720216 - 0 = 638.282375555531256342
              // remain to remove: 499.320483716405360108 - 0 = 499.320483716405360108
              // remove rate: 0.5

              // realized: -0.03848929880503395
              // fee: -0.641411877777656281
              // equity after remove position: 997.999555555033063935
              // withdraw amount: 997.999555555033063935 - 499.320483716405360108 = 498.679071838627703827

              // -withdraw amount + realized + fee
              it('should change vault balance -499.358973015210394058', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.358973015210394058');
              });

              it('should change wallet balance 498.679071', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '498.679071');
              });

              it('should change insurance account balance 0.000000838627703827', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000838627703827');
              });

              // remove size: 3 * 0.5 = 1.5
              it('should be trader size -1.5', async () => {
                assert.equal(strFromDecimal(position.size), '-1.5');
              });

              // freeWithdrawableAmount 0, healthFactor shouldn't decrease
              it('should be healthFactor >= 3.328803224776035734', async () => {
                assert.equal(strFromDecimal(accountInfo.healthFactor), '3.328803224776035734');
              });
            });
          });
        });

        context('when freeWithdrawableRate is 0.5', () => {
          const freeWithdrawableRate = toDecimalStr(0.5);

          context('when rate is 1', () => {
            const rate = toDecimalStr(1);

            context('when reservedRate is 0', () => {
              const reservedRate = toDecimalStr(0);
              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              it('should change vault balance -998.717946030420788116', async () => {
                assert.equal(strFromDecimal(vaultChange), '-998.717946030420788116');
              });

              it('should change wallet balance 997.358143', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '997.358143');
              });

              it('should change insurance account balance 0.000000677255407653', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000677255407653');
              });

              it('should be trader size 0', async () => {
                assert.equal(strFromDecimal(position.size), '0');
              });

              it('should be trader notional 0', async () => {
                assert.equal(strFromDecimal(position.notional), '0');
              });
            });

            context('when reservedRate is 0.5', () => {
              const reservedRate = toDecimalStr(0.5);
              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              it('should change vault balance -998.717946030420788116', async () => {
                assert.equal(strFromDecimal(vaultChange), '-998.717946030420788116');
              });

              it('should change wallet balance 997.358143', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '997.358143');
              });

              it('should change insurance account balance 0.000000677255407653', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000677255407653');
              });

              it('should be trader size 0', async () => {
                assert.equal(strFromDecimal(position.size), '0');
              });

              it('should be trader notional 0', async () => {
                assert.equal(strFromDecimal(position.notional), '0');
              });
            });

            context('when reservedRate is 1', () => {
              const reservedRate = toDecimalStr(1);
              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              it('should change vault balance -998.717946030420788116', async () => {
                assert.equal(strFromDecimal(vaultChange), '-998.717946030420788116');
              });

              it('should change wallet balance 997.358143', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '997.358143');
              });

              it('should change insurance account balance 0.000000677255407653', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000677255407653');
              });

              it('should be trader size 0', async () => {
                assert.equal(strFromDecimal(position.size), '0');
              });

              it('should be trader notional 0', async () => {
                assert.equal(strFromDecimal(position.notional), '0');
              });
            });
          });

          context('when rate is 0.5', () => {
            const rate = toDecimalStr(0.5);

            context('when reservedRate is 0', () => {
              const reservedRate = toDecimalStr(0);
              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.640967432810720216',
              // available: '698.640967432810720216',
              // healthFactor: '3.328803224776035734'
              // balance: 998.717946030420788116

              // reservedRate: 0
              // reserved: 0
              // adjustedAvailable: 698.640967432810720216
              // adjustedEquity: 998.640967432810720216

              // freeWithdrawableRate: 0.5
              // maxFreeWithdrawableAmount1: adjustedEquity - (adjustedEquity - adjustedAvailable) / freeWithdrawableRate = 398.640967432810720216
              // maxFreeWithdrawableAmount2: 398.640967432810720216 / 1 = 398.640967432810720216
              // expectToWithdrawAmount: 499.320483716405360108

              // equity after free: 998.640967432810720216 - 398.640967432810720216 = 600
              // remain to remove: 499.320483716405360108 - 398.640967432810720216 = 100.679516283594639892
              // remove rate: 100.679516283594639892 / 600 = 0.167799193805991066

              // realized: -0.112916946619285184
              // fee: -0.215256791977355201
              // equity after remove position: 998.425710640833365016
              // withdraw amount: 998.425710640833365016 - 499.320483716405360108 = 499.105226924428004908

              // -withdraw amount + realized + fee
              it('should change vault balance -499.333400663024645293', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.333400663024645293');
              });

              it('should change wallet balance 499.105226', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.105226');
              });

              it('should change insurance account balance 0.000000924428004908', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000924428004908');
              });

              // remove size: 3 * 0.167799193805991066 = 0.503397581417973198
              it('should be trader size -2.496602418582026802', async () => {
                assert.equal(strFromDecimal(position.size), '-2.496602418582026802');
              });
            });

            context('when reservedRate is 0.5', () => {
              const reservedRate = toDecimalStr(0.5);
              let vaultChange, walletChange, insuranceAccountChange, position, accountInfo;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position, accountInfo } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                    rate, freeWithdrawableRate, reservedRate, includeAccountInfo: true
                  }
                ));
              });

              // equity: '998.640967432810720216',
              // available: '698.640967432810720216',
              // healthFactor: '3.328803224776035734'
              // balance: 998.717946030420788116

              // reservedRate: 0.5
              // reserved: 518.461671494170988279
              // adjustedAvailable: 180.179295938639731937
              // adjustedEquity: 480.179295938639731937

              // freeWithdrawableRate: 0.5
              // maxFreeWithdrawableAmount1: adjustedEquity - (adjustedEquity - adjustedAvailable) / freeWithdrawableRate = -119.820704061360268063
              // maxFreeWithdrawableAmount2: 398.640967432810720216 / 1 = -xx
              // expectToWithdrawAmount: 499.320483716405360108

              // equity after free: 998.640967432810720216
              // remain to remove: 499.320483716405360108 - 0 = 499.320483716405360108
              // remove rate: 499.320483716405360108 / 998.640967432810720216 = 0.5

              // realized: -0.03848929880503395
              // fee: -0.641411877777656281
              // equity after remove position: 997.999555555033063935
              // withdraw amount: 997.999555555033063935 - 499.320483716405360108 = 498.679071838627703827

              // -withdraw amount + realized + fee
              it('should change vault balance -499.358973015210394058', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.358973015210394058');
              });

              it('should change wallet balance 498.679071', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '498.679071');
              });

              it('should change insurance account balance 0.000000838627703827', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000838627703827');
              });

              // remove size: 3 * 0.5 = 1.5
              it('should be trader size -1.5', async () => {
                assert.equal(strFromDecimal(position.size), '-1.5');
              });

              // freeWithdrawableAmount 0, healthFactor shouldn't decrease
              it('should be healthFactor >= 3.328803224776035734', async () => {
                assert.equal(strFromDecimal(accountInfo.healthFactor), '3.328803224776035734');
              });
            });

            context('when reservedRate is 1', () => {
              const reservedRate = toDecimalStr(1);
              let vaultChange, walletChange, insuranceAccountChange, position, accountInfo;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position, accountInfo } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                    rate, freeWithdrawableRate, reservedRate, includeAccountInfo: true
                  }
                ));
              });

              // equity: '998.640967432810720216',
              // available: '698.640967432810720216',
              // healthFactor: '3.328803224776035734'
              // balance: 998.717946030420788116

              // reservedRate: 1
              // reserved: 1036.923342988341976558
              // adjustedAvailable: -xx
              // adjustedEquity: -xx

              // freeWithdrawableRate: 0.5
              // maxFreeWithdrawableAmount: 0
              // expectToWithdrawAmount: 499.320483716405360108

              // equity after free: 998.640967432810720216
              // remain to remove: 499.320483716405360108 - 0 = 499.320483716405360108
              // remove rate: 499.320483716405360108 / 998.640967432810720216 = 0.5

              // realized: -0.03848929880503395
              // fee: -0.641411877777656281
              // equity after remove position: 997.999555555033063935
              // withdraw amount: 997.999555555033063935 - 499.320483716405360108 = 498.679071838627703827

              // -withdraw amount + realized + fee
              it('should change vault balance -499.358973015210394058', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.358973015210394058');
              });

              it('should change wallet balance 498.679071', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '498.679071');
              });

              it('should change insurance account balance 0.000000838627703827', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000838627703827');
              });

              // remove size: 3 * 0.5 = 1.5
              it('should be trader size -1.5', async () => {
                assert.equal(strFromDecimal(position.size), '-1.5');
              });

              // freeWithdrawableAmount 0, healthFactor shouldn't decrease
              it('should be healthFactor >= 3.328803224776035734', async () => {
                assert.equal(strFromDecimal(accountInfo.healthFactor), '3.328803224776035734');
              });
            });
          });
        });

        context('when freeWithdrawableRate is 0', () => {
          const freeWithdrawableRate = toDecimalStr(0);

          context('when tradable', () => {
            context('when rate is 1', () => {
              const rate = toDecimalStr(1);

              context('when reservedRate is 0', () => {
                const reservedRate = toDecimalStr(0);
                let vaultChange, walletChange, insuranceAccountChange, position;

                before(async () => {
                  ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                    vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                      rate, freeWithdrawableRate, reservedRate
                    }
                  ));
                });

                it('should change vault balance -998.717946030420788116', async () => {
                  assert.equal(strFromDecimal(vaultChange), '-998.717946030420788116');
                });

                it('should change wallet balance 997.358143', async () => {
                  assert.equal(strFromDecimal(walletChange, 6), '997.358143');
                });

                it('should change insurance account balance 0.000000677255407653', async () => {
                  assert.equal(strFromDecimal(insuranceAccountChange), '0.000000677255407653');
                });

                it('should be trader size 0', async () => {
                  assert.equal(strFromDecimal(position.size), '0');
                });

                it('should be trader notional 0', async () => {
                  assert.equal(strFromDecimal(position.notional), '0');
                });
              });

              context('when reservedRate is 0.5', () => {
                const reservedRate = toDecimalStr(0.5);
                let vaultChange, walletChange, insuranceAccountChange, position;

                before(async () => {
                  ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                    vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                      rate, freeWithdrawableRate, reservedRate
                    }
                  ));
                });

                it('should change vault balance -998.717946030420788116', async () => {
                  assert.equal(strFromDecimal(vaultChange), '-998.717946030420788116');
                });

                it('should change wallet balance 997.358143', async () => {
                  assert.equal(strFromDecimal(walletChange, 6), '997.358143');
                });

                it('should change insurance account balance 0.000000677255407653', async () => {
                  assert.equal(strFromDecimal(insuranceAccountChange), '0.000000677255407653');
                });

                it('should be trader size 0', async () => {
                  assert.equal(strFromDecimal(position.size), '0');
                });

                it('should be trader notional 0', async () => {
                  assert.equal(strFromDecimal(position.notional), '0');
                });
              });

              context('when reservedRate is 1', () => {
                const reservedRate = toDecimalStr(1);
                let vaultChange, walletChange, insuranceAccountChange, position;

                before(async () => {
                  ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                    vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                      rate, freeWithdrawableRate, reservedRate
                    }
                  ));
                });

                it('should change vault balance -998.717946030420788116', async () => {
                  assert.equal(strFromDecimal(vaultChange), '-998.717946030420788116');
                });

                it('should change wallet balance 997.358143', async () => {
                  assert.equal(strFromDecimal(walletChange, 6), '997.358143');
                });

                it('should change insurance account balance 0.000000677255407653', async () => {
                  assert.equal(strFromDecimal(insuranceAccountChange), '0.000000677255407653');
                });

                it('should be trader size 0', async () => {
                  assert.equal(strFromDecimal(position.size), '0');
                });

                it('should be trader notional 0', async () => {
                  assert.equal(strFromDecimal(position.notional), '0');
                });
              });
            });

            context('when rate is 0.5', () => {
              const rate = toDecimalStr(0.5);

              context('when reservedRate is 0', () => {
                const reservedRate = toDecimalStr(0);
                let vaultChange, walletChange, insuranceAccountChange, position, accountInfo;

                before(async () => {
                  ({ vaultChange, walletChange, insuranceAccountChange, position, accountInfo } = await traderWithdrawPercent(
                    vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                      rate, freeWithdrawableRate, reservedRate, includeAccountInfo: true
                    }
                  ));
                });

                // equity: '998.640967432810720216',
                // available: '698.640967432810720216',
                // healthFactor: '3.328803224776035734'
                // balance: 998.717946030420788116

                // reservedRate: 0
                // reserved: 0
                // adjustedAvailable: 698.640967432810720216
                // adjustedEquity: 998.640967432810720216

                // freeWithdrawableRate: 0
                // maxFreeWithdrawableAmount: 0
                // expectToWithdrawAmount: 499.320483716405360108

                // equity after free: 998.640967432810720216
                // remain to remove: 499.320483716405360108 - 0 = 499.320483716405360108
                // remove rate: 499.320483716405360108 / 998.640967432810720216 = 0.5

                // realized: -0.03848929880503395
                // fee: -0.641411877777656281
                // equity after remove position: 997.999555555033063935
                // withdraw amount: 997.999555555033063935 - 499.320483716405360108 = 498.679071838627703827

                // -withdraw amount + realized + fee
                it('should change vault balance -499.358973015210394058', async () => {
                  assert.equal(strFromDecimal(vaultChange), '-499.358973015210394058');
                });

                it('should change wallet balance 498.679071', async () => {
                  assert.equal(strFromDecimal(walletChange, 6), '498.679071');
                });

                it('should change insurance account balance 0.000000838627703827', async () => {
                  assert.equal(strFromDecimal(insuranceAccountChange), '0.000000838627703827');
                });

                // remove size: 3 * 0.5 = 1.5
                it('should be trader size -1.5', async () => {
                  assert.equal(strFromDecimal(position.size), '-1.5');
                });

                // freeWithdrawableAmount 0, healthFactor shouldn't decrease
                it('should be healthFactor >= 3.328803224776035734', async () => {
                  assert.equal(strFromDecimal(accountInfo.healthFactor), '3.328803224776035734');
                });
              });

              context('when reservedRate is 0.5', () => {
                const reservedRate = toDecimalStr(0.5);
                let vaultChange, walletChange, insuranceAccountChange, position, accountInfo;

                before(async () => {
                  ({ vaultChange, walletChange, insuranceAccountChange, position, accountInfo } = await traderWithdrawPercent(
                    vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                      rate, freeWithdrawableRate, reservedRate, includeAccountInfo: true
                    }
                  ));
                });

                // equity: '998.640967432810720216',
                // available: '698.640967432810720216',
                // healthFactor: '3.328803224776035734'
                // balance: 998.717946030420788116

                // reservedRate: 0.5
                // reserved: 518.461671494170988279
                // adjustedAvailable: 180.179295938639731937
                // adjustedEquity: 480.179295938639731937

                // freeWithdrawableRate: 0
                // maxFreeWithdrawableAmount: 0
                // expectToWithdrawAmount: 499.320483716405360108

                // equity after free: 998.640967432810720216
                // remain to remove: 499.320483716405360108 - 0 = 499.320483716405360108
                // remove rate: 499.320483716405360108 / 998.640967432810720216 = 0.5

                // realized: -0.03848929880503395
                // fee: -0.641411877777656281
                // equity after remove position: 997.999555555033063935
                // withdraw amount: 997.999555555033063935 - 499.320483716405360108 = 498.679071838627703827

                // -withdraw amount + realized + fee
                it('should change vault balance -499.358973015210394058', async () => {
                  assert.equal(strFromDecimal(vaultChange), '-499.358973015210394058');
                });

                it('should change wallet balance 498.679071', async () => {
                  assert.equal(strFromDecimal(walletChange, 6), '498.679071');
                });

                it('should change insurance account balance 0.000000838627703827', async () => {
                  assert.equal(strFromDecimal(insuranceAccountChange), '0.000000838627703827');
                });

                // remove size: 3 * 0.5 = 1.5
                it('should be trader size -1.5', async () => {
                  assert.equal(strFromDecimal(position.size), '-1.5');
                });

                // freeWithdrawableAmount 0, healthFactor shouldn't decrease
                it('should be healthFactor >= 3.328803224776035734', async () => {
                  assert.equal(strFromDecimal(accountInfo.healthFactor), '3.328803224776035734');
                });
              });

              context('when reservedRate is 1', () => {
                const reservedRate = toDecimalStr(1);
                let vaultChange, walletChange, insuranceAccountChange, position, accountInfo;

                before(async () => {
                  ({ vaultChange, walletChange, insuranceAccountChange, position, accountInfo } = await traderWithdrawPercent(
                    vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                      rate, freeWithdrawableRate, reservedRate, includeAccountInfo: true
                    }
                  ));
                });

                // equity: '998.640967432810720216',
                // available: '698.640967432810720216',
                // healthFactor: '3.328803224776035734'
                // balance: 998.717946030420788116

                // reservedRate: 1
                // reserved: 1036.923342988341976558
                // adjustedAvailable: -xx
                // adjustedEquity: -xx

                // freeWithdrawableRate: 0
                // maxFreeWithdrawableAmount: 0
                // expectToWithdrawAmount: 499.320483716405360108

                // equity after free: 998.640967432810720216
                // remain to remove: 499.320483716405360108 - 0 = 499.320483716405360108
                // remove rate: 499.320483716405360108 / 998.640967432810720216 = 0.5

                // realized: -0.03848929880503395
                // fee: -0.641411877777656281
                // equity after remove position: 997.999555555033063935
                // withdraw amount: 997.999555555033063935 - 499.320483716405360108 = 498.679071838627703827

                // -withdraw amount + realized + fee
                it('should change vault balance -499.358973015210394058', async () => {
                  assert.equal(strFromDecimal(vaultChange), '-499.358973015210394058');
                });

                it('should change wallet balance 498.679071', async () => {
                  assert.equal(strFromDecimal(walletChange, 6), '498.679071');
                });

                it('should change insurance account balance 0.000000838627703827', async () => {
                  assert.equal(strFromDecimal(insuranceAccountChange), '0.000000838627703827');
                });

                // remove size: 3 * 0.5 = 1.5
                it('should be trader size -1.5', async () => {
                  assert.equal(strFromDecimal(position.size), '-1.5');
                });

                // freeWithdrawableAmount 0, healthFactor shouldn't decrease
                it('should be healthFactor >= 3.328803224776035734', async () => {
                  assert.equal(strFromDecimal(accountInfo.healthFactor), '3.328803224776035734');
                });
              });
            });
          });

          context('when untradable', () => {
            const expiry2 = expiry + 86400;

            before(async () => {
              await vault.setIv([
                buildIv(expiry2, strike, true, true, toDecimalStr(0.8), false),
                buildIv(expiry2, strike, true, false, toDecimalStr(0.8), false)
              ]);
              await optionPricer.updateLookup([expiry2]);
              await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-3), 0);
              await vault.connect(trader).trade(expiry2, strike, true, toDecimalStr(-2), 0);
            });

            after(async () => {
              await vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(1));
              await vault.connect(trader).deposit(toDecimalStr(1000));
              await reset();
            });

            context('when tradeDisabled', () => {
              before(async () => {
                await vault.setTradeDisabled(true);
              });

              after(async () => {
                await vault.setTradeDisabled(false);
              });

              context('when rate 1', () => {
                it('should revert with "withdraw too much"', async () => {
                  await expectRevert(vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, freeWithdrawableRate), 'withdraw too much');
                });
              });

              context('when rate 0.0001', () => {
                it('should revert with "withdraw too much"', async () => {
                  await expectRevert(vault.connect(trader).withdrawPercent(toDecimalStr(0.0001), 0, freeWithdrawableRate), 'withdraw too much');
                });
              });
            });

            context('when expiryDisabled', () => {
              before(async () => {
                await vault.setExpiryDisabled(expiry, true);
              });

              after(async () => {
                await vault.setExpiryDisabled(expiry, false);
              });

              context('when rate 1', () => {
                it('should revert with "withdraw too much"', async () => {
                  await expectRevert(vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, freeWithdrawableRate), 'withdraw too much');
                });
              });

              context('when rate 0.0001', () => {
                it('should remove tradable one', async () => {
                  await vault.connect(trader).withdrawPercent(toDecimalStr(0.0001), 0, freeWithdrawableRate);
                  const position = await vault.positionOf(trader.address, expiry, strike, true);
                  assert.equal(strFromDecimal(position.size), '-3');
                });
              });
            });

            context('when market disabled', () => {
              context('when both', () => {
                before(async () => {
                  await vault.setIv([
                    buildIv(expiry, strike, true, true, toDecimalStr(0.8), true),
                    buildIv(expiry, strike, true, false, toDecimalStr(0.8), true)
                  ]);
                });

                after(async () => {
                  await vault.setIv([
                    buildIv(expiry, strike, true, true, toDecimalStr(0.8), false),
                    buildIv(expiry, strike, true, false, toDecimalStr(0.8), false)
                  ]);
                });

                context('when rate 1', () => {
                  it('should revert with "withdraw too much"', async () => {
                    await expectRevert(vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, freeWithdrawableRate), 'withdraw too much');
                  });
                });

                context('when rate 0.0001', () => {
                  it('should remove tradable one', async () => {
                    await vault.connect(trader).withdrawPercent(toDecimalStr(0.0001), 0, freeWithdrawableRate);
                    const position = await vault.positionOf(trader.address, expiry, strike, true);
                    assert.equal(strFromDecimal(position.size), '-3');
                  });
                });
              });

              context('when buy', () => {
                before(async () => {
                  await vault.setIv([buildIv(expiry, strike, true, true, toDecimalStr(0.8), true)]);
                });

                after(async () => {
                  await vault.setIv([buildIv(expiry, strike, true, true, toDecimalStr(0.8), false)]);
                });

                context('when rate 1', () => {
                  it('should revert with "withdraw too much"', async () => {
                    await expectRevert(vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, freeWithdrawableRate), 'withdraw too much');
                  });
                });

                context('when rate 0.0001', () => {
                  it('should remove tradable one', async () => {
                    await vault.connect(trader).withdrawPercent(toDecimalStr(0.0001), 0, freeWithdrawableRate);
                    const position = await vault.positionOf(trader.address, expiry, strike, true);
                    assert.equal(strFromDecimal(position.size), '-3');
                  });
                });
              });
            });

            context('when iv outdated', () => {
              before(async () => {
                await vault.setTimestamp(now + 3601);
              });

              after(async () => {
                await vault.setTimestamp(now);
              });

              context('when rate 1', () => {
                it('should revert with "withdraw too much"', async () => {
                  await expectRevert(vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, freeWithdrawableRate), 'withdraw too much');
                });
              });

              context('when rate 0.0001', () => {
                it('should revert with "withdraw too much"', async () => {
                  await expectRevert(vault.connect(trader).withdrawPercent(toDecimalStr(0.0001), 0, freeWithdrawableRate), 'withdraw too much');
                });
              });
            });

            context('when expired', () => {
              before(async () => {
                await vault.setTimestamp(expiry);
                await vault.setIv([buildIv(expiry2, strike, true, true, toDecimalStr(0.8), false)]);
              });

              after(async () => {
                await vault.setTimestamp(now);
                await vault.setIv([buildIv(expiry2, strike, true, true, toDecimalStr(0.8), false)]);
              });

              context('when rate 1', () => {
                it('should revert with "withdraw too much"', async () => {
                  await expectRevert(vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, freeWithdrawableRate), 'withdraw too much');
                });
              });

              context('when rate 0.0001', () => {
                it('should remove tradable one', async () => {
                  await vault.connect(trader).withdrawPercent(toDecimalStr(0.0001), 0, freeWithdrawableRate);
                  const position = await vault.positionOf(trader.address, expiry, strike, true);
                  assert.equal(strFromDecimal(position.size), '-3');
                });
              });
            });
          });
        });

        context('when other cases', () => {
          const freeWithdrawableRate = toDecimalStr(0);
          const rate = toDecimalStr(1);
          const reservedRate = toDecimalStr(0);

          context('when remove sell position', () => {
            const rate = toDecimalStr('0.499999999999999999');

            let accountInfo, accountInfoBefore;

            before(async () => {
              ({ accountInfo, accountInfoBefore } = await traderWithdrawPercent(
                vault, usdc, trader, expiry, strike, true, toDecimalStr(-0.001), {
                  rate, freeWithdrawableRate, reservedRate, includeAccountInfo: true
                }
              ));
            });

            it('should not decrease healthFactor"', async () => {
              assert.equal(toBigNumber(accountInfo.healthFactor).gte(toBigNumber(accountInfoBefore.healthFactor)), true);
            });
          });

          context('when close sell size 0 and open 3', () => {
            let vaultChange, walletChange, insuranceAccountChange, position, poolPosition;

            before(async () => {
              await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(3), INT_MAX);
              ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                vault, usdc, trader, expiry, strike, true, toDecimalStr(-3), {
                  rate, freeWithdrawableRate, reservedRate,
                  beforeClear: async () => {
                    poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
                    await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(-3), 0);
                    await vault.connect(trader2).withdrawPercent(toDecimalStr(1), 0, 0);
                    await vault.connect(trader2).deposit(toDecimalStr(1000));
                  }
                }
              ));
            });

            // equity: '998.717176244444687437',
            // available: '698.717176244444687437',
            // healthFactor: '3.329057254148148958'
            // balance: 998.717176244444687437

            // realized: -0.602544788376970089
            // fee: -1.288849203439082262
            // withdraw amount: 996.825782252628635086

            it('should change vault balance -998.717176244444687437', async () => {
              assert.equal(strFromDecimal(vaultChange), '-998.717176244444687437');
            });

            it('should change wallet balance 996.825782', async () => {
              assert.equal(strFromDecimal(walletChange, 6), '996.825782');
            });

            it('should change insurance account balance 0.000000252628635086', async () => {
              assert.equal(strFromDecimal(insuranceAccountChange), '0.000000252628635086');
            });

            it('should be trader size 0', async () => {
              assert.equal(strFromDecimal(position.size), '0');
            });

            it('should be pool size -3', async () => {
              assert.equal(strFromDecimal(poolPosition.size), '-3');
            });
          });

          context('when close sell size 1 and open 3', () => {
            let vaultChange, walletChange, insuranceAccountChange, position, poolPosition;

            before(async () => {
              await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(3), INT_MAX);
              ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                vault, usdc, trader, expiry, strike, true, toDecimalStr(-4), {
                  rate, freeWithdrawableRate, reservedRate,
                  beforeClear: async () => {
                    poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
                    await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(-3), 0);
                    await vault.connect(trader2).withdrawPercent(toDecimalStr(1), 0, 0);
                    await vault.connect(trader2).deposit(toDecimalStr(1000));
                  }
                }
              ));
            });

            // equity: '998.281116141126548389',
            // available: '598.281116141126548389',
            // healthFactor: '2.495702790352816370'
            // balance: 998.289653701530287306

            // realized: -0.610564043972708812
            // fee: -1.716451938909439781
            // withdraw amount: 995.962637718648138713

            it('should change vault balance -998.289653701530287306', async () => {
              assert.equal(strFromDecimal(vaultChange), '-998.289653701530287306');
            });

            it('should change wallet balance 995.962637', async () => {
              assert.equal(strFromDecimal(walletChange, 6), '995.962637');
            });

            it('should change insurance account balance 0.000000718648138713', async () => {
              assert.equal(strFromDecimal(insuranceAccountChange), '0.000000718648138713');
            });

            it('should be trader size 0', async () => {
              assert.equal(strFromDecimal(position.size), '0');
            });

            it('should be pool size -3', async () => {
              assert.equal(strFromDecimal(poolPosition.size), '-3');
            });
          });
        });
      });

      context('when buy position', () => {
        context('when freeWithdrawableRate 1', () => {
          const freeWithdrawableRate = toDecimalStr(1);

          context('when rate 1', () => {
            const rate = toDecimalStr(1);

            context('when reservedRate 1', () => {
              const reservedRate = toDecimalStr(1);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // realized: -0.604458561403125087
              // fee: -1.282823755555312563
              // withdraw amount: 996.823849341872218537

              it('should change vault balance -998.711131658830656187', async () => {
                assert.equal(strFromDecimal(vaultChange), '-998.711131658830656187');
              });

              it('should change wallet balance 996.823849', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '996.823849');
              });

              it('should change insurance account balance 0.000000341872218537', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000341872218537');
              });

              it('should be trader size 0', async () => {
                assert.equal(strFromDecimal(position.size), '0');
              });

              it('should be trader notional 0', async () => {
                assert.equal(strFromDecimal(position.notional), '0');
              });
            });

            context('when reservedRate 0.5', () => {
              const reservedRate = toDecimalStr(0.5);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // realized: -0.604458561403125087
              // fee: -1.282823755555312563
              // withdraw amount: 996.823849341872218537

              it('should change vault balance -998.711131658830656187', async () => {
                assert.equal(strFromDecimal(vaultChange), '-998.711131658830656187');
              });

              it('should change wallet balance 996.823849', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '996.823849');
              });

              it('should change insurance account balance 0.000000341872218537', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000341872218537');
              });

              it('should be trader size 0', async () => {
                assert.equal(strFromDecimal(position.size), '0');
              });

              it('should be trader notional 0', async () => {
                assert.equal(strFromDecimal(position.notional), '0');
              });
            });

            context('when reservedRate 0', () => {
              const reservedRate = toDecimalStr(0);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // realized: -0.604458561403125087
              // fee: -1.282823755555312563
              // withdraw amount: 996.823849341872218537

              it('should change vault balance -998.711131658830656187', async () => {
                assert.equal(strFromDecimal(vaultChange), '-998.711131658830656187');
              });

              it('should change wallet balance 996.823849', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '996.823849');
              });

              it('should change insurance account balance 0.000000341872218537', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000341872218537');
              });

              it('should be trader size 0', async () => {
                assert.equal(strFromDecimal(position.size), '0');
              });

              it('should be trader notional 0', async () => {
                assert.equal(strFromDecimal(position.notional), '0');
              });
            });
          });

          context('when rate 0.5', () => {
            const rate = toDecimalStr(0.5);

            context('when reservedRate 1', () => {
              const reservedRate = toDecimalStr(1);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // expectToWithdrawAmount: 499.05333654871376555
              // expectToWithdrawAmount < available won't remove buy position

              // realized: 0
              // fee: 0
              // withdraw amount: 499.05333654871376555

              it('should change vault balance -499.05333654871376555', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.05333654871376555');
              });

              it('should change wallet balance 499.053336', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.053336');
              });

              it('should change insurance account balance 0.00000054871376555', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.00000054871376555');
              });

              it('should be trader size 3', async () => {
                assert.equal(strFromDecimal(position.size), '3');
              });
            });

            context('when reservedRate 0.5', () => {
              const reservedRate = toDecimalStr(0.5);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // expectToWithdrawAmount: 499.05333654871376555
              // expectToWithdrawAmount < available won't remove buy position

              // realized: 0
              // fee: 0
              // withdraw amount: 499.05333654871376555

              it('should change vault balance -499.05333654871376555', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.05333654871376555');
              });

              it('should change wallet balance 499.053336', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.053336');
              });

              it('should change insurance account balance 0.00000054871376555', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.00000054871376555');
              });

              it('should be trader size 3', async () => {
                assert.equal(strFromDecimal(position.size), '3');
              });
            });

            context('when reservedRate 0', () => {
              const reservedRate = toDecimalStr(0);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // expectToWithdrawAmount: 499.05333654871376555
              // expectToWithdrawAmount < available won't remove buy position

              // realized: 0
              // fee: 0
              // withdraw amount: 499.05333654871376555

              it('should change vault balance -499.05333654871376555', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.05333654871376555');
              });

              it('should change wallet balance 499.053336', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.053336');
              });

              it('should change insurance account balance 0.00000054871376555', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.00000054871376555');
              });

              it('should be trader size 3', async () => {
                assert.equal(strFromDecimal(position.size), '3');
              });
            });
          });
        });

        context('when freeWithdrawableRate 0.5', () => {
          const freeWithdrawableRate = toDecimalStr(0.5);

          context('when rate 1', () => {
            const rate = toDecimalStr(1);

            context('when reservedRate 1', () => {
              const reservedRate = toDecimalStr(1);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // realized: -0.604458561403125087
              // fee: -1.282823755555312563
              // withdraw amount: 996.823849341872218537

              it('should change vault balance -998.711131658830656187', async () => {
                assert.equal(strFromDecimal(vaultChange), '-998.711131658830656187');
              });

              it('should change wallet balance 996.823849', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '996.823849');
              });

              it('should change insurance account balance 0.000000341872218537', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000341872218537');
              });

              it('should be trader size 0', async () => {
                assert.equal(strFromDecimal(position.size), '0');
              });

              it('should be trader notional 0', async () => {
                assert.equal(strFromDecimal(position.notional), '0');
              });
            });

            context('when reservedRate 0.5', () => {
              const reservedRate = toDecimalStr(0.5);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // realized: -0.604458561403125087
              // fee: -1.282823755555312563
              // withdraw amount: 996.823849341872218537

              it('should change vault balance -998.711131658830656187', async () => {
                assert.equal(strFromDecimal(vaultChange), '-998.711131658830656187');
              });

              it('should change wallet balance 996.823849', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '996.823849');
              });

              it('should change insurance account balance 0.000000341872218537', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000341872218537');
              });

              it('should be trader size 0', async () => {
                assert.equal(strFromDecimal(position.size), '0');
              });

              it('should be trader notional 0', async () => {
                assert.equal(strFromDecimal(position.notional), '0');
              });
            });

            context('when reservedRate 0', () => {
              const reservedRate = toDecimalStr(0);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // realized: -0.604458561403125087
              // fee: -1.282823755555312563
              // withdraw amount: 996.823849341872218537

              it('should change vault balance -998.711131658830656187', async () => {
                assert.equal(strFromDecimal(vaultChange), '-998.711131658830656187');
              });

              it('should change wallet balance 996.823849', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '996.823849');
              });

              it('should change insurance account balance 0.000000341872218537', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.000000341872218537');
              });

              it('should be trader size 0', async () => {
                assert.equal(strFromDecimal(position.size), '0');
              });

              it('should be trader notional 0', async () => {
                assert.equal(strFromDecimal(position.notional), '0');
              });
            });
          });

          context('when rate 0.5', () => {
            const rate = toDecimalStr(0.5);

            context('when reservedRate 1', () => {
              const reservedRate = toDecimalStr(1);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // expectToWithdrawAmount: 499.05333654871376555
              // expectToWithdrawAmount < available won't remove buy position

              // realized: 0
              // fee: 0
              // withdraw amount: 499.05333654871376555

              it('should change vault balance -499.05333654871376555', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.05333654871376555');
              });

              it('should change wallet balance 499.053336', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.053336');
              });

              it('should change insurance account balance 0.00000054871376555', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.00000054871376555');
              });

              it('should be trader size 3', async () => {
                assert.equal(strFromDecimal(position.size), '3');
              });
            });

            context('when reservedRate 0.5', () => {
              const reservedRate = toDecimalStr(0.5);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // expectToWithdrawAmount: 499.05333654871376555
              // expectToWithdrawAmount < available won't remove buy position

              // realized: 0
              // fee: 0
              // withdraw amount: 499.05333654871376555

              it('should change vault balance -499.05333654871376555', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.05333654871376555');
              });

              it('should change wallet balance 499.053336', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.053336');
              });

              it('should change insurance account balance 0.00000054871376555', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.00000054871376555');
              });

              it('should be trader size 3', async () => {
                assert.equal(strFromDecimal(position.size), '3');
              });
            });

            context('when reservedRate 0', () => {
              const reservedRate = toDecimalStr(0);

              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // expectToWithdrawAmount: 499.05333654871376555
              // expectToWithdrawAmount < available won't remove buy position

              // realized: 0
              // fee: 0
              // withdraw amount: 499.05333654871376555

              it('should change vault balance -499.05333654871376555', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.05333654871376555');
              });

              it('should change wallet balance 499.053336', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.053336');
              });

              it('should change insurance account balance 0.00000054871376555', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.00000054871376555');
              });

              it('should be trader size 3', async () => {
                assert.equal(strFromDecimal(position.size), '3');
              });
            });
          });
        });

        context('when freeWithdrawableRate 0', () => {
          const freeWithdrawableRate = toDecimalStr(0);

          context('when rate 1', () => {
            const rate = toDecimalStr(1);

            context('when reservedRate 1', () => {
              const reservedRate = toDecimalStr(1);

              context('when other pool not available', () => {
                before(async () => {
                  await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(6), INT_MAX);
                  await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-6), 0);
                  await vault.connect(pool).withdrawPercent(toDecimalStr(0.9), 0, 0);
                });

                after(async () => {
                  await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(-6), 0);
                  await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(6), INT_MAX);
                  await vault.connect(trader2).withdrawPercent(toDecimalStr(1), 0, 0);
                  await vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, 0);
                  await vault.connect(trader).deposit(toDecimalStr(1000));
                  await vault.connect(trader2).deposit(toDecimalStr(1000));
                  await reset();
                });

                it('should revert with "pool unavailable"', async () => {
                  await expectRevert(vault.connect(trader).withdrawPercent(rate, 0, freeWithdrawableRate), 'pool unavailable');
                });
              });

              context('when other pool available', () => {
                let vaultChange, walletChange, insuranceAccountChange, position;

                before(async () => {
                  ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                    vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                      rate, freeWithdrawableRate, reservedRate
                    }
                  ));
                });

                // equity: '998.1066730974275311',
                // available: '959.824297541896274758',
                // healthFactor: '26.072224061686145190'
                // balance: 998.711131658830656187

                // realized: -0.604458561403125087
                // fee: -1.282823755555312563
                // withdraw amount: 996.823849341872218537

                it('should change vault balance -998.711131658830656187', async () => {
                  assert.equal(strFromDecimal(vaultChange), '-998.711131658830656187');
                });

                it('should change wallet balance 996.823849', async () => {
                  assert.equal(strFromDecimal(walletChange, 6), '996.823849');
                });

                it('should change insurance account balance 0.000000341872218537', async () => {
                  assert.equal(strFromDecimal(insuranceAccountChange), '0.000000341872218537');
                });

                it('should be trader size 0', async () => {
                  assert.equal(strFromDecimal(position.size), '0');
                });

                it('should be trader notional 0', async () => {
                  assert.equal(strFromDecimal(position.notional), '0');
                });
              });
            });

            context('when reservedRate 0.5', () => {
              const reservedRate = toDecimalStr(0.5);

              context('when other pool not available', () => {
                before(async () => {
                  await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(6), INT_MAX);
                  await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-6), 0);
                  await vault.connect(pool).withdrawPercent(toDecimalStr(0.9), 0, 0);
                });

                after(async () => {
                  await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(-6), 0);
                  await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(6), INT_MAX);
                  await vault.connect(trader2).withdrawPercent(toDecimalStr(1), 0, 0);
                  await vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, 0);
                  await vault.connect(trader).deposit(toDecimalStr(1000));
                  await vault.connect(trader2).deposit(toDecimalStr(1000));
                  await reset();
                });

                it('should revert with "pool unavailable"', async () => {
                  await expectRevert(vault.connect(trader).withdrawPercent(rate, 0, freeWithdrawableRate), 'pool unavailable');
                });
              });

              context('when other pool available', () => {
                let vaultChange, walletChange, insuranceAccountChange, position;

                before(async () => {
                  ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                    vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                      rate, freeWithdrawableRate, reservedRate
                    }
                  ));
                });

                // equity: '998.1066730974275311',
                // available: '959.824297541896274758',
                // healthFactor: '26.072224061686145190'
                // balance: 998.711131658830656187

                // realized: -0.604458561403125087
                // fee: -1.282823755555312563
                // withdraw amount: 996.823849341872218537

                it('should change vault balance -998.711131658830656187', async () => {
                  assert.equal(strFromDecimal(vaultChange), '-998.711131658830656187');
                });

                it('should change wallet balance 996.823849', async () => {
                  assert.equal(strFromDecimal(walletChange, 6), '996.823849');
                });

                it('should change insurance account balance 0.000000341872218537', async () => {
                  assert.equal(strFromDecimal(insuranceAccountChange), '0.000000341872218537');
                });

                it('should be trader size 0', async () => {
                  assert.equal(strFromDecimal(position.size), '0');
                });

                it('should be trader notional 0', async () => {
                  assert.equal(strFromDecimal(position.notional), '0');
                });
              });
            });

            context('when reservedRate 0', () => {
              const reservedRate = toDecimalStr(0);

              context('when other pool not available', () => {
                before(async () => {
                  await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(6), INT_MAX);
                  await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-6), 0);
                  await vault.connect(pool).withdrawPercent(toDecimalStr(0.9), 0, 0);
                });

                after(async () => {
                  await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(-6), 0);
                  await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(6), INT_MAX);
                  await vault.connect(trader2).withdrawPercent(toDecimalStr(1), 0, 0);
                  await vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, 0);
                  await vault.connect(trader).deposit(toDecimalStr(1000));
                  await vault.connect(trader2).deposit(toDecimalStr(1000));
                  await reset();
                });

                it('should revert with "pool unavailable"', async () => {
                  await expectRevert(vault.connect(trader).withdrawPercent(rate, 0, freeWithdrawableRate), 'pool unavailable');
                });
              });

              context('when other pool available', () => {
                let vaultChange, walletChange, insuranceAccountChange, position;

                before(async () => {
                  ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                    vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                      rate, freeWithdrawableRate, reservedRate
                    }
                  ));
                });

                // equity: '998.1066730974275311',
                // available: '959.824297541896274758',
                // healthFactor: '26.072224061686145190'
                // balance: 998.711131658830656187

                // realized: -0.604458561403125087
                // fee: -1.282823755555312563
                // withdraw amount: 996.823849341872218537

                it('should change vault balance -998.711131658830656187', async () => {
                  assert.equal(strFromDecimal(vaultChange), '-998.711131658830656187');
                });

                it('should change wallet balance 996.823849', async () => {
                  assert.equal(strFromDecimal(walletChange, 6), '996.823849');
                });

                it('should change insurance account balance 0.000000341872218537', async () => {
                  assert.equal(strFromDecimal(insuranceAccountChange), '0.000000341872218537');
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

          context('when rate 0.5', () => {
            const rate = toDecimalStr(0.5);

            context('when reservedRate 1', () => {
              const reservedRate = toDecimalStr(1);
              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // expectToWithdrawAmount: 499.05333654871376555
              // expectToWithdrawAmount < available won't remove buy position

              // realized: 0
              // fee: 0
              // withdraw amount: 499.05333654871376555

              it('should change vault balance -499.05333654871376555', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.05333654871376555');
              });

              it('should change wallet balance 499.053336', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.053336');
              });

              it('should change insurance account balance 0.00000054871376555', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.00000054871376555');
              });

              it('should be trader size 3', async () => {
                assert.equal(strFromDecimal(position.size), '3');
              });
            });

            context('when reservedRate 0.5', () => {
              const reservedRate = toDecimalStr(0.5);
              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // expectToWithdrawAmount: 499.05333654871376555
              // expectToWithdrawAmount < available won't remove buy position

              // realized: 0
              // fee: 0
              // withdraw amount: 499.05333654871376555

              it('should change vault balance -499.05333654871376555', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.05333654871376555');
              });

              it('should change wallet balance 499.053336', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.053336');
              });

              it('should change insurance account balance 0.00000054871376555', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.00000054871376555');
              });

              it('should be trader size 3', async () => {
                assert.equal(strFromDecimal(position.size), '3');
              });
            });

            context('when reservedRate 0', () => {
              const reservedRate = toDecimalStr(0);
              let vaultChange, walletChange, insuranceAccountChange, position;

              before(async () => {
                ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                  vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                    rate, freeWithdrawableRate, reservedRate
                  }
                ));
              });

              // equity: '998.1066730974275311',
              // available: '959.824297541896274758',
              // healthFactor: '26.072224061686145190'
              // balance: 998.711131658830656187

              // expectToWithdrawAmount: 499.05333654871376555
              // expectToWithdrawAmount < available won't remove buy position

              // realized: 0
              // fee: 0
              // withdraw amount: 499.05333654871376555

              it('should change vault balance -499.05333654871376555', async () => {
                assert.equal(strFromDecimal(vaultChange), '-499.05333654871376555');
              });

              it('should change wallet balance 499.053336', async () => {
                assert.equal(strFromDecimal(walletChange, 6), '499.053336');
              });

              it('should change insurance account balance 0.00000054871376555', async () => {
                assert.equal(strFromDecimal(insuranceAccountChange), '0.00000054871376555');
              });

              it('should be trader size 3', async () => {
                assert.equal(strFromDecimal(position.size), '3');
              });
            });
          });

          context('when rate 0.961645005902295551', () => {
            const rate = toDecimalStr('0.961645005902295551');
            const reservedRate = toDecimalStr(0);

            let vaultChange, walletChange, insuranceAccountChange, position;

            before(async () => {
              ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                  rate, freeWithdrawableRate, reservedRate
                }
              ));
            });

            // equity: '998.1066730974275311',
            // available: '959.824297541896274758',
            // healthFactor: '26.072224061686145190'
            // balance: 998.711131658830656187

            // expectToWithdrawAmount: 959.824297541896274191
            // expectToWithdrawAmount < available won't remove buy position

            // realized: 0
            // fee: 0
            // withdraw amount: 959.824297541896274191

            it('should change vault balance -959.824297541896274191', async () => {
              assert.equal(strFromDecimal(vaultChange), '-959.824297541896274191');
            });

            it('should change wallet balance 959.824297', async () => {
              assert.equal(strFromDecimal(walletChange, 6), '959.824297');
            });

            it('should change insurance account balance 0.000000541896274191', async () => {
              assert.equal(strFromDecimal(insuranceAccountChange), '0.000000541896274191');
            });

            it('should be trader size 3', async () => {
              assert.equal(strFromDecimal(position.size), '3');
            });
          });

          context('when rate 0.961645005902295552', () => {
            const rate = toDecimalStr('0.961645005902295552');
            const reservedRate = toDecimalStr(0);

            let vaultChange, walletChange, insuranceAccountChange, position;

            before(async () => {
              ({ vaultChange, walletChange, insuranceAccountChange, position } = await traderWithdrawPercent(
                vault, usdc, trader, expiry, strike, true, toDecimalStr(3), {
                  rate, freeWithdrawableRate, reservedRate
                }
              ));
            });

            // equity: '998.1066730974275311',
            // available: '959.824297541896274758',
            // healthFactor: '26.072224061686145190'
            // balance: 998.711131658830656187

            // expectToWithdrawAmount: 959.824297541896275189
            // remain to remove: expectToWithdrawAmount - available = 0.000000000000000431
            // equity after free: 998.1066730974275311 - 959.824297541896274758 = 38.282375555531256342
            // expectedRemainEquity: equity after free - remain to remove = 38.282375555531256342 - 0.000000000000000431 = 38.282375555531255911

            // full premium; 38.282375555531256342
            // full fee: -1.282823755555312563
            // remove size: ceil(-3 * 0.000000000000000431 / (38.282375555531256342 - 1.282823755555312563))
            //              = -0.000000000000000034

            // realized: -0.000000000000000007
            // fee: -0.000000000000000014
            // equity after remove position: 998.106673097427531085
            // withdraw amount: 998.106673097427531085 - 38.282375555531255911 = 959.824297541896275174

            // -withdraw amount + realized + fee
            it('should change vault balance -959.824297541896275195', async () => {
              assert.equal(strFromDecimal(vaultChange), '-959.824297541896275195');
            });

            it('should change wallet balance 959.824297', async () => {
              assert.equal(strFromDecimal(walletChange, 6), '959.824297');
            });

            it('should change insurance account balance 0.000000541896275174', async () => {
              assert.equal(strFromDecimal(insuranceAccountChange), '0.000000541896275174');
            });

            it('should be trader size 2.999999999999999966', async () => {
              assert.equal(strFromDecimal(position.size), '2.999999999999999966');
            });
          });
        });

        context('when other cases', () => {
          const freeWithdrawableRate = toDecimalStr(0);
          const reservedRate = toDecimalStr(0);

          context('when close buy and open partial', () => {
            const rate = toDecimalStr('0.974432955877182827');
            let vaultChange, walletChange, insuranceAccountChange, position, accountInfo, poolPosition;

            before(async () => {
              await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(-3), 0);
              ({ vaultChange, walletChange, insuranceAccountChange, position, accountInfo } = await traderWithdrawPercent(
                vault, usdc, trader, expiry, strike, true, toDecimalStr(4), {
                  rate, freeWithdrawableRate, reservedRate, includeAccountInfo: true,
                  beforeClear: async () => {
                    poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
                    await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(3), INT_MAX);
                    await vault.connect(trader2).withdrawPercent(toDecimalStr(1), 0, 0);
                    await vault.connect(trader2).deposit(toDecimalStr(1000));
                  }
                }
              ));
            });

            // equity: '998.221913377577404013',
            // available: '947.178745970202395557',
            // healthFactor: '19.556425748636997764'
            // balance: 998.288898474952498967

            // expectToWithdrawAmount: 972.700329673889900483
            // remain to remove: expectToWithdrawAmount - available = 25.521583703687504926
            // equity after free: 998.221913377577404013 - 947.178745970202395557 = 51.043167407375008456
            // expectedRemainEquity: equity after free - remain to remove = 51.043167407375008456 - 25.521583703687504926 = 25.52158370368750353

            // full premium; 38.205669843028099737
            // full fee: -1.282056698430280995
            // already remove value: 12.333183933325314593
            // deploy remain to remove: 25.521583703687504926 - 12.333183933325314593 = 13.188399770362190333
            // remove size: ceil(-3 * 13.188399770362190333 / (38.205669843028099737 - 1.282056698430280995))
            //              = -1.071541919696318632

            // realized: -0.044489192051917276
            // fee: -0.885709742577530509
            // equity after remove position: 997.326405052249818486
            // withdraw amount: equity after remove position - expectedRemainEquity
            //                  = 997.326405052249818486 - 25.52158370368750353 = 971.804821348562314956

            // -withdraw amount + realized + fee
            it('should change vault balance -972.735020283191762741', async () => {
              assert.equal(strFromDecimal(vaultChange), '-972.735020283191762741');
            });

            it('should change wallet balance 971.804821', async () => {
              assert.equal(strFromDecimal(walletChange, 6), '971.804821');
            });

            it('should change insurance account balance 0.000000348562314956', async () => {
              assert.equal(strFromDecimal(insuranceAccountChange), '0.000000348562314956');
            });

            it('should be trader size 1.928458080303681368', async () => {
              assert.equal(strFromDecimal(position.size), '1.928458080303681368');
            });

            it('should be pool size 1.071541919696318632', async () => {
              assert.equal(strFromDecimal(poolPosition.size), '1.071541919696318632');
            });

            it('should be available > 0', async () => {
              assert.equal(toBigNumber(accountInfo.available).gte(0), true);
            });
          });

          context('when partial close size', () => {
            const rate = toDecimalStr('0.948865911754365653');
            let vaultChange, walletChange, insuranceAccountChange, position, accountInfo, poolPosition;

            before(async () => {
              await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(-3), 0);
              ({ vaultChange, walletChange, insuranceAccountChange, position, accountInfo } = await traderWithdrawPercent(
                vault, usdc, trader, expiry, strike, true, toDecimalStr(4), {
                  rate, freeWithdrawableRate, reservedRate, includeAccountInfo: true,
                  beforeClear: async () => {
                    poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
                    await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(-3), 0);
                    await vault.connect(trader2).withdrawPercent(toDecimalStr(1), 0, 0);
                    await vault.connect(trader2).deposit(toDecimalStr(1000));
                  }
                }
              ));
            });

            // equity: '998.221913377577404013',
            // available: '947.178745970202395557',
            // healthFactor: '19.556425748636997764'
            // balance: 998.288898474952498967

            // expectToWithdrawAmount: 947.178745970202395955
            // remain to remove: expectToWithdrawAmount - available = 0.000000000000000398
            // equity after free: 998.221913377577404013 - 947.178745970202395557 = 51.043167407375008456
            // expectedRemainEquity: equity after free - remain to remove = 51.043167407375008456 - 0.000000000000000398 = 51.043167407375008058

            // full premium; 12.760791851843752114
            // full fee: -0.427607918518437521
            // remove size: ceil(-1 * 0.000000000000000398 / (12.760791851843752114 - 0.427607918518437521))
            //              = -0.000000000000000032

            // realized: 0
            // fee: -0.000000000000000013
            // equity after remove position: 998.221913377577403999
            // withdraw amount: equity after remove position - expectedRemainEquity
            //                  = 998.221913377577403999 - 51.043167407375008058 = 947.178745970202395941

            // -withdraw amount + realized + fee
            it('should change vault balance -947.178745970202395954', async () => {
              assert.equal(strFromDecimal(vaultChange), '-947.178745970202395954');
            });

            it('should change wallet balance 947.178745', async () => {
              assert.equal(strFromDecimal(walletChange, 6), '947.178745');
            });

            it('should change insurance account balance 0.000000970202395941', async () => {
              assert.equal(strFromDecimal(insuranceAccountChange), '0.000000970202395941');
            });

            it('should be trader size 3.999999999999999968', async () => {
              assert.equal(strFromDecimal(position.size), '3.999999999999999968');
            });

            it('should be pool size -0.999999999999999968', async () => {
              assert.equal(strFromDecimal(poolPosition.size), '-0.999999999999999968');
            });

            it('should be available > 0', async () => {
              assert.equal(toBigNumber(accountInfo.available).gte(0), true);
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
              ivs.push(buildIv(e, s, true, true, toDecimalStr(0.8), false));
              ivs.push(buildIv(e, s, true, false, toDecimalStr(0.8), false));
              ivs.push(buildIv(e, s, false, true, toDecimalStr(0.8), false));
              ivs.push(buildIv(e, s, false, false, toDecimalStr(0.8), false));
            });
          });
          await vault.setIv(ivs);
          await optionPricer.updateLookup([expiry, expiry2]);
          await vault.connect(trader).trade(expiry, s1200, false, toDecimalStr(0.1), INT_MAX);
          await vault.connect(trader).trade(expiry, s1200, true, toDecimalStr(0.1), INT_MAX);
          await vault.connect(trader).trade(expiry2, s1200, false, toDecimalStr(0.1), INT_MAX);
          await vault.connect(trader).trade(expiry2, s1200, true, toDecimalStr(0.1), INT_MAX);
          for (const e of [expiry2, expiry]) {
            for (const s of [s900_1, s1000, s1100]) {
              await vault.connect(trader).trade(e, s, true, toDecimalStr(-0.1), 0);
              await vault.connect(trader).trade(e, s, false, toDecimalStr(-0.1), 0);
            }
          }
          const result = await (await vault.connect(trader).withdrawPercent(toDecimalStr(1), 0, toDecimalStr(0))).wait();
          events = result.events.filter((e) => e.event === 'PositionUpdate');
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
