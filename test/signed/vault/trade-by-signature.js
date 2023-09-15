const assert = require('assert');
const BigNumber = require('bigNumber.js');
const { signData, signTrade, withSignedData, ivsToPrices, getSigners, getContractFactories, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, watchBalance, addPool, mintAndDeposit, INT_MAX, expectRevertCustom } = require('../../support/helper');

let Vault, Config, OptionMarket, TestERC20, SpotPricer, accounts;
describe('Vault', () => {
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

  const tradeBySignature = async (vault, signer, data, deadline, gasFee, signedData = null) => {
    if (!signedData) {
      signedData = await createSignedData({ nonce: vault.address });
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
    [Vault, Config, OptionMarket, TestERC20, SpotPricer] = await getContractFactories('TestSignedVault', 'Config', 'TestOptionMarket', 'TestERC20', 'TestSpotPricer');
    accounts = await getSigners();
    [stakeholderAccount, insuranceAccount, trader, trader2, pool, pool2, pool3] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer('SignedOptionPricer');
    signatureValidator = await createSignatureValidator();
  });

  describe('#tradeBySignature', () => {
    let vault, config, usdc, optionMarket, signedData;

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

    context('when gasFee is -1', () => {
      const gasFee = new BigNumber(INT_MAX).plus(1).toString(10);

      it('should revert with OutOfRange', async () => {
        await expectRevertCustom(tradeBySignature(vault, trader, [expiry, strike, 1, toDecimalStr(1), INT_MAX], now, gasFee), Vault, 'OutOfRange');
      });
    });

    context('when gasFee is 0', () => {
      const gasFee = toDecimalStr(0);
      let traderChange, poolChange, traderPosition, poolPosition;

      before(async () => {
        [traderChange, poolChange] = await watchBalance(vault, [trader.address, pool.address], async () => {
          await tradeBySignature(vault, trader, [expiry, strike, 1, toDecimalStr(-1), 0], now, gasFee);
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
          await expectRevertCustom(tradeBySignature(vault, trader2, [expiry, strike, 1, toDecimalStr(1), INT_MAX], now, gasFee), Vault, 'Unavailable');
        });
      });

      context('when sender is not owner', () => {
        it('should revert with NotOwner', async () => {
          await expectRevertCustom(tradeBySignature(vault.connect(trader), trader, [expiry, strike, 1, toDecimalStr(-1), 0], now, gasFee), Vault, 'NotOwner');
        });
      });

      context('when sender is owner', () => {
        context('when open only', () => {
          let traderChange, poolChange, trader2Change, traderPosition, poolPosition;

          before(async () => {
            [traderChange, poolChange, trader2Change] = await watchBalance(vault, [trader.address, pool.address, stakeholderAccount.address], async () => {
              await tradeBySignature(vault, trader, [expiry, strike, 1, toDecimalStr(-1), 0], now, gasFee);
            });
            traderPosition = await vault.positionOf(trader.address, expiry, strike, true);
            poolPosition = await vault.positionOf(pool.address, expiry, strike, true);
            await reset();
            await withSignedData(vault.connect(stakeholderAccount), signedData).withdrawPercent(toDecimalStr(1), 0, 0);
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
        });

        context('when hf < 1', () => {
          before(async () => {
            await tradeBySignature(vault, trader, [expiry, strike, 1, toDecimalStr(-1), 0], now, gasFee);
            await spotPricer.setPrice(toDecimalStr(1950));
          });

          after(async () => {
            await spotPricer.setPrice(toDecimalStr(1000));
            await reset();
            await withSignedData(vault.connect(stakeholderAccount), signedData).withdrawPercent(toDecimalStr(1), 0, 0);
          })

          context('when then size 0.1', () => {
            let accountInfoBefore, accountInfoAfter;

            before(async () => {
              accountInfoBefore = await withSignedData(vault, signedData).getAccountInfo(trader.address);
              await tradeBySignature(vault, trader, [expiry, strike, 1, toDecimalStr(0.1), INT_MAX], now, gasFee);
              accountInfoAfter = await withSignedData(vault, signedData).getAccountInfo(trader.address);
            });

            it('should increase healthFactor', async () => {
              assert.equal(accountInfoAfter.healthFactor.gt(accountInfoBefore.healthFactor), true);
            });
          });

          context('when then size 0.000000000000000001', () => {
            const size = toDecimalStr('0.000000000000000001');

            it('should revert with Unavailable', async () => {
              await expectRevertCustom(tradeBySignature(vault, trader, [expiry, strike, 1, size, INT_MAX], now, gasFee), Vault, 'Unavailable');
            });
          });
        });
      });
    });
  });
});
