const { ethers } = require('hardhat');
const assert = require('assert');
const BigNumber = require('bigNumber.js');
const { signData, signTrade, withSignedData, ivsToPrices, getSigners, getContractFactories, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, watchBalance, addPool, mintAndDeposit, INT_MAX, expectRevertCustom, expectRevert } = require('../support/helper');

let Vault, Config, OptionMarket, TestERC20, SpotPricer, VaultOwner, accounts;
describe('Vault', () => {
  let stakeholderAccount, insuranceAccount, trader, trader2, pool, pool2, liquidator;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer, signatureValidator;
  let vault, config, usdc, optionMarket, vaultOwner, vaultProxy;

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
    const vaultOwner = await VaultOwner.deploy();
    await vaultOwner.initialize(vault.address);
    await vaultOwner.grantRole('0x872340a532bdd7bb02bea115c1b0f1ba87eac982f5b79b51ac189ffaac1b6fce', stakeholderAccount.address);
    await vaultOwner.grantRole('0x872340a532bdd7bb02bea115c1b0f1ba87eac982f5b79b51ac189ffaac1b6fce', insuranceAccount.address);
    await vaultOwner.grantRole('0xeb33521169e672634fcae38dcc3bab0be8a080072000cfbdc0e041665d727c18', stakeholderAccount.address);
    await vaultOwner.grantRole('0xeb33521169e672634fcae38dcc3bab0be8a080072000cfbdc0e041665d727c18', liquidator.address);
    await vault.changeOwner(vaultOwner.address);
    const vaultProxy = await ethers.getContractAt('TestSignedVault', vaultOwner.address);
    return { vault, config, usdc, optionMarket, vaultOwner, vaultProxy };
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
    [Vault, Config, OptionMarket, TestERC20, SpotPricer, VaultOwner] = await getContractFactories('TestSignedVault', 'Config', 'TestOptionMarket', 'TestERC20', 'TestSpotPricer', 'VaultOwner');
    accounts = await getSigners();
    [stakeholderAccount, insuranceAccount, trader, trader2, pool, pool2, liquidator] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer('SignedOptionPricer');
    signatureValidator = await createSignatureValidator();
    ({ vault, config, usdc, optionMarket, vaultOwner, vaultProxy } = await setup());
  });

  describe('#tradeBySignature', () => {
    let vault, config, usdc, vaultOwner, vaultProxy, signedData;

    const reset = async () => {
      await withSignedData(vault.connect(trader), signedData).withdrawPercent(toDecimalStr(1), 0, 0);
      await vault.connect(trader).deposit(toDecimalStr(1000));
      await withSignedData(vault.connect(pool), signedData).withdrawPercent(toDecimalStr(1), 0, 0);
      await vault.connect(pool).deposit(toDecimalStr(1000));
    };

    before(async () => {
      ({ vault, config, usdc, vaultOwner, vaultProxy } = await setup());
      signedData = await createSignedData();
      await addPool(config, pool);
      await addPool(config, pool2);
      await mintAndDeposit(vault, usdc, pool, { mint: 10000000 });
      await mintAndDeposit(vault, usdc, trader, { mint: 10000000 });
    });

    context('when gasFee is -1', () => {
      const gasFee = new BigNumber(INT_MAX).plus(1).toString(10);

      it('should revert with OutOfRange', async () => {
        await expectRevertCustom(tradeBySignature(vaultProxy, trader, [expiry, strike, 1, toDecimalStr(1), INT_MAX], now, gasFee), Vault, 'OutOfRange');
      });
    });

    context('when gasFee is 0', () => {
      const gasFee = toDecimalStr(0);
      let traderChange, poolChange, traderPosition, poolPosition;

      before(async () => {
        [traderChange, poolChange] = await watchBalance(vault, [trader.address, pool.address], async () => {
          await tradeBySignature(vaultProxy, trader, [expiry, strike, 1, toDecimalStr(-1), 0], now, gasFee);
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

    context('when gasFee is 1', () => {
      const gasFee = toDecimalStr(1);

      context('when trader not available', () => {
        it('should revert with Unavailable', async () => {
          await expectRevertCustom(tradeBySignature(vaultProxy, trader2, [expiry, strike, 1, toDecimalStr(1), INT_MAX], now, gasFee), Vault, 'Unavailable');
        });
      });

      context('when sender is not vaultOwner', () => {
        it('should revert with NotOwner', async () => {
          await expectRevertCustom(tradeBySignature(vault, trader, [expiry, strike, 1, toDecimalStr(-1), 0], now, gasFee), Vault, 'NotOwner');
        });
      });

      context('when sender is vaultOwner', () => {
        context('when sender does not have role', () => {
          it('should revert with "AccessControl: account"', async () => {
            await expectRevert(tradeBySignature(vaultProxy.connect(trader), trader, [expiry, strike, 1, toDecimalStr(-1), 0], now, gasFee), /AccessControl: account/);
          });
        });

        context('when sender has role', () => {
          context('when open only', () => {
            let traderChange, poolChange, trader2Change, traderPosition, poolPosition, vaultOwnerBalance;

            before(async () => {
              [traderChange, poolChange, trader2Change] = await watchBalance(vault, [trader.address, pool.address, vaultOwner.address], async () => {
                await tradeBySignature(vaultProxy.connect(insuranceAccount), trader, [expiry, strike, 1, toDecimalStr(-1), 0], now, gasFee);
              });
              traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
              poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
              await reset();
              await withSignedData(vaultProxy, signedData).withdrawPercent(toDecimalStr(1), 0, 0);
              await usdc.balanceOf(vaultOwner.address)
              vaultOwnerBalance = await usdc.balanceOf(vaultOwner.address);
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

            it('should change trader balance -1.427526357222716313', async () => {
              assert.equal(strFromDecimal(traderChange), '-1.427526357222716313');
            });

            it('should change pool balance 0.427526357222716313', async () => {
              assert.equal(strFromDecimal(poolChange), '0.427526357222716313');
            });

            it('should change trader2 balance 1', async () => {
              assert.equal(strFromDecimal(trader2Change), '1');
            });

            it('should be vaultOwner balance 1', async () => {
              assert.equal(strFromDecimal(vaultOwnerBalance, 6), '1');
            });
          });

          context('when hf < 1', () => {
            let signedData2;

            before(async () => {
              await tradeBySignature(vaultProxy.connect(insuranceAccount), trader, [expiry, strike, 1, toDecimalStr(-1), 0], now, gasFee);
              signedData2 = await createSignedData({ spot: toDecimalStr(1950) });
            });

            after(async () => {
              await reset();
              await withSignedData(vault, signedData).withdrawPercent(toDecimalStr(1), 0, 0);
            })

            context('when then size 0.1', () => {
              let accountInfoBefore, accountInfoAfter;

              before(async () => {
                accountInfoBefore = await withSignedData(vault, signedData2).getAccountInfo(trader.address);
                await tradeBySignature(vaultProxy.connect(insuranceAccount), trader, [expiry, strike, 1, toDecimalStr(0.1), INT_MAX], now, gasFee, signedData2);
                accountInfoAfter = await withSignedData(vault, signedData2).getAccountInfo(trader.address);
              });

              it('should increase healthFactor', async () => {
                assert.equal(accountInfoAfter.healthFactor.gt(accountInfoBefore.healthFactor), true);
              });
            });

            context('when then size 0.000000000000000001', () => {
              const size = toDecimalStr('0.000000000000000001');

              it('should revert with Unavailable', async () => {
                await expectRevertCustom(tradeBySignature(vaultProxy.connect(insuranceAccount), trader, [expiry, strike, 1, size, INT_MAX], now, gasFee, signedData2), Vault, 'Unavailable');
              });
            });
          });
        });
      });
    });
  });

  describe('#trade', () => {
    let vault, config, usdc, vaultOwner, vaultProxy, signedData;

    const reset = async () => {
      await withSignedData(vaultProxy, signedData).withdrawPercent(toDecimalStr(1), 0, 0);
      await vaultProxy.deposit(toDecimalStr(1000));
      await withSignedData(vault.connect(pool), signedData).withdrawPercent(toDecimalStr(1), 0, 0);
      await vault.connect(pool).deposit(toDecimalStr(1000));
    };

    before(async () => {
      ({ vault, config, usdc, vaultOwner, vaultProxy } = await setup());
      signedData = await createSignedData();
      await addPool(config, pool);
      await addPool(config, pool2);
      await mintAndDeposit(vault, usdc, pool, { mint: 10000000 });
      await usdc.mint(vaultOwner.address, toDecimalStr('10000000', 6));
      await vaultProxy.deposit(toDecimalStr('1000'));
    });

    context('when sender does not have role', () => {
      it('should revert with "AccessControl: account"', async () => {
        await expectRevert(withSignedData(vaultProxy.connect(trader), signedData).trade([expiry, strike, 1, toDecimalStr(-1), 0], now), /AccessControl: account/);
      });
    });

    context('when sender has role', () => {
      let vaultOwnerBalance, poolChange, vaultOwnerPosition, poolPosition;

      before(async () => {
        [vaultOwnerBalance, poolChange] = await watchBalance(vault, [vaultOwner.address, pool.address], async () => {
          await withSignedData(vaultProxy.connect(liquidator), signedData).trade([expiry, strike, 1, toDecimalStr(-1), 0], now);
        });
        vaultOwnerPosition = await vault.positionOf(vaultOwner.address, expiry, strike, true);
        poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
        await reset();
      });

      // fee: 0.427526357222716313
      it('should be trader size -1', async () => {
        assert.equal(strFromDecimal(vaultOwnerPosition.size), '-1');
      });

      it('should be trader notional 12.752635722271631374', async () => {
        assert.equal(strFromDecimal(vaultOwnerPosition.notional), '12.752635722271631374');
      });

      it('should be pool size 1', async () => {
        assert.equal(strFromDecimal(poolPosition.size), '1');
      });

      it('should be pool notional -12.752635722271631374', async () => {
        assert.equal(strFromDecimal(poolPosition.notional), '-12.752635722271631374');
      });

      it('should change trader balance -0.427526357222716313', async () => {
        assert.equal(strFromDecimal(vaultOwnerBalance), '-0.427526357222716313');
      });

      it('should change pool balance 0.427526357222716313', async () => {
        assert.equal(strFromDecimal(poolChange), '0.427526357222716313');
      });
    });
  });

  describe('#deposit', () => {
    before(async () => {
      await usdc.mint(vaultOwner.address, toDecimalStr('1000', 6));
    });

    context('when sender does not have role', () => {
      it('should revert with "AccessControl: account"', async () => {
        await expectRevert(vaultProxy.connect(trader).deposit(toDecimalStr('1000')), /AccessControl: account/);
      });
    });

    context('when sender has role', () => {
      let tvlChange, vaultOwnerBalance;

      before(async () => {
        [tvlChange, vaultOwnerBalance] = await watchBalance(usdc, [vault.address, vaultOwner.address], async () => {
          await vaultProxy.connect(liquidator).deposit(toDecimalStr('1000'));
        });
      });

      it('should increase tvl 1000', async () => {
        assert.equal(strFromDecimal(tvlChange, 6), '1000');
        assert.equal(strFromDecimal(vaultOwnerBalance, 6), '-1000');
      });
    })
  });

  describe('#liquidate', () => {
    let vault, config, usdc, optionMarket, vaultOwner, vaultProxy, signedData5;
    const strike2 = toDecimalStr(1200);
    const ivs = [
      [expiry, strike, true, true, toDecimalStr(0.8), false],
      [expiry, strike, true, false, toDecimalStr(0.8), false],
      [expiry, strike, false, true, toDecimalStr(0.8), false],
      [expiry, strike, false, false, toDecimalStr(0.8), false],
      [expiry, strike2, true, true, toDecimalStr(0.8), false],
      [expiry, strike2, true, false, toDecimalStr(0.8), false]
    ];

    before(async () => {
      ({ vault, config, usdc, optionMarket, vaultOwner, vaultProxy } = await setup());
      await config.setLiquidateRate(toDecimalStr('0.825124542401224942'));
      const signedData = await createSignedData({ ivs, spot: toDecimalStr(1000) });
      await addPool(config, pool);
      await mintAndDeposit(vault, usdc, pool, { amount: 10000 });
      await mintAndDeposit(vault, usdc, trader);
      await usdc.mint(vaultOwner.address, toDecimalStr('10000', 6));
      await vaultProxy.deposit(toDecimalStr('10000'));
      await tradeBySignature(vaultProxy, trader, [expiry, strike, 1, toDecimalStr(-6), 0], now, 0, signedData);
      await tradeBySignature(vaultProxy, trader, [expiry, strike, 0, toDecimalStr('0.000000000000000001'), INT_MAX], now, 0, signedData);
      await tradeBySignature(vaultProxy, trader, [expiry, strike2, 1, toDecimalStr('6.000000000000000001'), INT_MAX], now, 0, signedData);
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
      await withSignedData(vaultProxy.connect(liquidator), signedData3).liquidate(trader.address, expiry, strike, true, toDecimalStr(6));
      const signedData4 = await createSignedData({ ivs: [...ivs, ...ivs2], spot: toDecimalStr(1400) });
      await withSignedData(vaultProxy.connect(liquidator), signedData4).liquidate(trader.address, expiry, strike, true, toDecimalStr(6));
      signedData5 = await createSignedData({ ivs: [...ivs, ...ivs2], spot: toDecimalStr(1300) });
    });

    context('when sender does not have role', () => {
      it('should revert with "AccessControl: account"', async () => {
        await expectRevert(withSignedData(vaultProxy.connect(trader), signedData5).liquidate(trader.address, expiry, strike, false, toDecimalStr(1)), /AccessControl: account/);
      });
    });

    context('when sender has role', () => {
      let traderBalanceChange, vaultOwnerBalanceChange, insuranceAccountBalanceChange, traderPosition, vaultOwnerPosition;

      before(async () => {
        // liquidate all
        [traderBalanceChange, vaultOwnerBalanceChange, insuranceAccountBalanceChange] = await watchBalance(vault, [trader.address, vaultOwner.address, insuranceAccount.address], async () => {
          await withSignedData(vaultProxy.connect(liquidator), signedData5).liquidate(trader.address, expiry, strike, false, toDecimalStr(1));
        });
        traderPosition = await vault.positionOf(trader.address, expiry, strike, false);
        vaultOwnerPosition = await vault.positionOf(vaultOwner.address, expiry, strike, false);
      });

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

      it('should change vaultOwner balance 0', async () => {
        assert.equal(strFromDecimal(vaultOwnerBalanceChange), '0');
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

      it('should be vaultOwner size 0.000000000000000001', async () => {
        assert.equal(strFromDecimal(vaultOwnerPosition.size), '0.000000000000000001');
      });

      it('should be vaultOwner notional -0.000000000000000003', async () => {
        assert.equal(strFromDecimal(vaultOwnerPosition.notional), '-0.000000000000000003');
      });
    });
  });
});
