const assert = require('assert');
const { signData, signTrade, withSignedData, ivsToPrices, getContractFactories, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, addPool, mintAndDeposit, INT_MAX } = require('../../support/helper');

let Vault, Config, OptionMarket, TestERC20, SpotPricer, accounts;
describe('SignedVault', () => {
  let stakeholderAccount, insuranceAccount, trader, trader2, pool;
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
    await optionMarket.initialize();
    await vault.setTimestamp(now);
    await signatureValidator.grantRole('0x2db9fd3d099848027c2383d0a083396f6c41510d7acfd92adc99b6cffcf31e96', vault.address);
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
    [Vault, Config, OptionMarket, TestERC20, SpotPricer] = await getContractFactories('TestSignedVault', 'Config', 'TestOptionMarket', 'TestERC20', 'TestSpotPricer');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader, trader2, pool] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer('SignedOptionPricer');
    signatureValidator = await createSignatureValidator();
  });

  describe('#getAccountInfo', () => {
    let vault, config, usdc, optionMarket, signedData;

    const getAccountInfoWithSettledPrice = async (vault, expiry, settledPrice, ivs) => {
      await vault.setTimestamp(expiry);
      await spotPricer.setSettledPrice(expiry, toDecimalStr(settledPrice));
      const signedData = await createSignedData({ ivs, nowTime: expiry });
      const accountInfo = await withSignedData(vault, signedData).getAccountInfo(trader2.address);
      await vault.setTimestamp(now);
      await spotPricer.setSettledPrice(expiry, 0);
      return accountInfo;
    }

    before(async () => {
      ({ vault, config, usdc, optionMarket } = await setup());
      signedData = await createSignedData();
    });

    context('when empty', () => {
      let accountInfo;

      before(async () => {
        accountInfo = await withSignedData(vault, signedData).getAccountInfo(trader.address);
      });

      it('should be initialMargin 0', async () => {
        assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
      });

      it('should be marginBalance 0', async () => {
        assert.equal(strFromDecimal(accountInfo.marginBalance), '0');
      });

      it('should be available 0', async () => {
        assert.equal(strFromDecimal(accountInfo.available), '0');
      });

      it('should be equity 0', async () => {
        assert.equal(strFromDecimal(accountInfo.equity), '0');
      });

      it('should be equityWithFee 0', async () => {
        assert.equal(strFromDecimal(accountInfo.equityWithFee), '0');
      });

      it('should be upnl 0', async () => {
        assert.equal(strFromDecimal(accountInfo.upnl), '0');
      });

      it('should be healthFactor INT_MAX', async () => {
        assert.equal(accountInfo.healthFactor, INT_MAX);
      });
    });

    context('when size 0', () => {
      let accountInfo;

      before(async () => {
        await mintAndDeposit(vault, usdc, trader);
        accountInfo = await await withSignedData(vault, signedData).getAccountInfo(trader.address);
      });

      it('should be initialMargin 0', async () => {
        assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
      });

      it('should be marginBalance 1000', async () => {
        assert.equal(strFromDecimal(accountInfo.marginBalance), '1000');
      });

      it('should be available 1000', async () => {
        assert.equal(strFromDecimal(accountInfo.available), '1000');
      });

      it('should be equity 1000', async () => {
        assert.equal(strFromDecimal(accountInfo.equity), '1000');
      });

      it('should be equityWithFee 1000', async () => {
        assert.equal(strFromDecimal(accountInfo.equityWithFee), '1000');
      });

      it('should be upnl 0', async () => {
        assert.equal(strFromDecimal(accountInfo.upnl), '0');
      });

      it('should be healthFactor INT_MAX', async () => {
        assert.equal(accountInfo.healthFactor, INT_MAX);
      });
    });

    context('when call', () => {
      context('when size is 1', () => {
        let accountInfo;

        before(async () => {
          await addPool(config, pool);
          await mintAndDeposit(vault, usdc, pool);
          await mintAndDeposit(vault, usdc, trader2);
          await tradeBySignature(vault, trader2, [expiry, strike, 1, toDecimalStr(1), INT_MAX], now, 0);
          accountInfo = await withSignedData(vault, signedData).getAccountInfo(trader2.address);
        });

        context('when price is unsettled', () => {
          it('should be initialMargin 0', async () => {
            assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
          });

          it('should be marginBalance 986.743351203124736844', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.571716348545789474
            // buyNotional: -12.828365145421052630
            assert.equal(strFromDecimal(accountInfo.marginBalance), '986.743351203124736844');
          });

          it('should be available 986.743351203124736844', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '986.743351203124736844');
          });

          it('should be equity 999.504552133124736844', async () => {
            // marginBalance + buyValue + sellValue
            // buyValue: 12.761200930000000000
            assert.equal(strFromDecimal(accountInfo.equity), '999.504552133124736844');
          });

          it('should be equityWithFee 999.076940123824736844', async () => {
            // equity + fee
            // fee: -0.427612009300000000
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '999.076940123824736844');
          });

          it('should be upnl -0.06716421542105263', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '-0.06716421542105263');
          });

          it('should be healthFactor 78.323706179048834774', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '78.323706179048834774');
          });
        });

        context('when settled price is 1100', () => {
          before(async () => {
            accountInfo = await getAccountInfoWithSettledPrice(vault, expiry, 1100);
          });

          it('should be initialMargin 0', async () => {
            assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
          });

          it('should be marginBalance 986.743351203124736844', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.571716348545789474
            // buyNotional: -12.82836514542105263
            assert.equal(strFromDecimal(accountInfo.marginBalance), '986.743351203124736844');
          });

          it('should be available 986.743351203124736844', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '986.743351203124736844');
          });

          it('should be equity 986.743351203124736844', async () => {
            // marginBalance + buyValue + sellValue
            // buyValue: 0
            assert.equal(strFromDecimal(accountInfo.equity), '986.743351203124736844');
          });

          it('should be equityWithFee 986.743351203124736844', async () => {
            // equity + fee
            // fee: 0
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '986.743351203124736844');
          });

          it('should be upnl -12.82836514542105263', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '-12.82836514542105263');
          });

          it('should be healthFactor INT_MAX', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(accountInfo.healthFactor, INT_MAX);
          });
        });

        context('when settled price is 1110', () => {
          before(async () => {
            accountInfo = await getAccountInfoWithSettledPrice(vault, expiry, 1110);
          });

          it('should be initialMargin 0', async () => {
            assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
          });

          it('should be marginBalance 986.743351203124736844', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.571716348545789474
            // buyNotional: -12.82836514542105263
            assert.equal(strFromDecimal(accountInfo.marginBalance), '986.743351203124736844');
          });

          it('should be available 986.743351203124736844', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '986.743351203124736844');
          });

          it('should be equity 996.743351203124736844', async () => {
            // marginBalance + buyValue + sellValue
            // buyValue: 10
            assert.equal(strFromDecimal(accountInfo.equity), '996.743351203124736844');
          });

          it('should be equityWithFee 996.576851203124736844', async () => {
            // equity + fee
            // fee: -0.1665 (exerciseFeeRate)
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '996.576851203124736844');
          });

          it('should be upnl -2.82836514542105263', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '-2.82836514542105263');
          });

          it('should be healthFactor 99.674335120312473684', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '99.674335120312473684');
          });
        });

        context('when settled price is 1100.1', () => {
          before(async () => {
            accountInfo = await getAccountInfoWithSettledPrice(vault, expiry, 1100.1);
          });

          it('should be initialMargin 0', async () => {
            assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
          });

          it('should be marginBalance 986.743351203124736844', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.571716348545789474
            // buyNotional: -12.82836514542105263
            assert.equal(strFromDecimal(accountInfo.marginBalance), '986.743351203124736844');
          });

          it('should be available 986.743351203124736844', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '986.743351203124736844');
          });

          it('should be equity 986.843351203124736844', async () => {
            // marginBalance + buyValue + sellValue
            // buyValue: 0.1
            assert.equal(strFromDecimal(accountInfo.equity), '986.843351203124736844');
          });

          it('should be equityWithFee 986.833351203124736844', async () => {
            // equity + fee
            // fee: -0.01 (profitFeeRate)
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '986.833351203124736844');
          });

          it('should be upnl -12.72836514542105263', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '-12.72836514542105263');
          });

          it('should be healthFactor 9868.43351203124736844', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '9868.43351203124736844');
          });
        });
      });

      context('when size is -1', () => {
        let vault, config, usdc, optionMarket, accountInfo, signedData;

        before(async () => {
          ({ vault, config, usdc, optionMarket } = await setup());
          signedData = await createSignedData();
          await addPool(config, pool);
          await mintAndDeposit(vault, usdc, pool);
          await mintAndDeposit(vault, usdc, trader2);
          await tradeBySignature(vault, trader2, [expiry, strike, 1, toDecimalStr(-1), 0], now, 0);
          accountInfo = await withSignedData(vault, signedData).getAccountInfo(trader2.address);
        });

        context('when price is unsettled', () => {
          it('should be initialMargin 112.76120093', async () => {
            // (-unsettledSellSize * spot + settledRisk) * initialMarginRiskRate + -sellValue
            // sellValue: -12.76120093
            // (1 * 1000 + 0) * 0.1 + 12.76120093
            assert.equal(strFromDecimal(accountInfo.initialMargin), '112.76120093');
          });

          it('should be marginBalance 1012.325109365048915061', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.572473642777283687
            // sellNotional: 12.752635722271631374
            assert.equal(strFromDecimal(accountInfo.marginBalance), '1012.325109365048915061');
          });

          it('should be available 899.563908435048915061', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '899.563908435048915061');
          });

          it('should be equity 999.563908435048915061', async () => {
            // marginBalance + buyValue + sellValue
            // sellValue: -12.76120093
            assert.equal(strFromDecimal(accountInfo.equity), '999.563908435048915061');
          });

          it('should be equityWithFee 999.136296425748915061', async () => {
            // equity + fee
            // fee: -0.4276120093
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '999.136296425748915061');
          });

          it('should be upnl -0.008565207728368626', async () => {
            // sellNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '-0.008565207728368626');
          });

          it('should be healthFactor 9.99563908435048915', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '9.99563908435048915');
          });
        });

        context('when settled price is 1100', () => {
          before(async () => {
            accountInfo = await getAccountInfoWithSettledPrice(vault, expiry, 1100);
          });

          it('should be initialMargin 110', async () => {
            // (-unsettledSellSize * spot + settledRisk) * initialMarginRiskRate + -sellValue
            // sellValue: 0
            // (0 + 1100) * 0.1 + 0
            assert.equal(strFromDecimal(accountInfo.initialMargin), '110');
          });

          it('should be marginBalance 1012.325109365048915061', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.572473642777283687
            // sellNotional: 12.752635722271631374
            assert.equal(strFromDecimal(accountInfo.marginBalance), '1012.325109365048915061');
          });

          it('should be available 902.324704921131130287', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '902.325109365048915061');
          });

          it('should be equity 1012.325109365048915061', async () => {
            // marginBalance + buyValue + sellValue
            // sellValue: 0
            assert.equal(strFromDecimal(accountInfo.equity), '1012.325109365048915061');
          });

          it('should be equityWithFee 1012.325109365048915061', async () => {
            // equity + fee
            // fee: 0
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '1012.325109365048915061');
          });

          it('should be upnl 12.752635722271631374', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '12.752635722271631374');
          });

          it('should be healthFactor 9.202955539682262864', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '9.202955539682262864');
          });
        });

        context('when settled price is 1110', () => {
          before(async () => {
            accountInfo = await getAccountInfoWithSettledPrice(vault, expiry, 1110);
          });

          it('should be initialMargin 121', async () => {
            // (-unsettledSellSize * spot + settledRisk) * initialMarginRiskRate + -sellValue
            // sellValue: -10
            // (0 + 1110) * 0.1 + 10
            assert.equal(strFromDecimal(accountInfo.initialMargin), '121');
          });

          it('should be marginBalance 1012.325109365048915061', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.572473642777283687
            // sellNotional: 12.752635722271631374
            assert.equal(strFromDecimal(accountInfo.marginBalance), '1012.325109365048915061');
          });

          it('should be available 891.325109365048915061', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '891.325109365048915061');
          });

          it('should be equity 1002.325109365048915061', async () => {
            // marginBalance + buyValue + sellValue
            // sellValue: -10
            assert.equal(strFromDecimal(accountInfo.equity), '1002.325109365048915061');
          });

          it('should be equityWithFee 1002.158609365048915061', async () => {
            // equity + fee
            // fee: -0.1665 (exerciseFeeRate)
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '1002.158609365048915061');
          });

          it('should be upnl 2.752635722271631374', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '2.752635722271631374');
          });

          it('should be healthFactor 9.029955940225665901', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '9.029955940225665901');
          });
        });

        context('when settled price is 1100.1', () => {
          before(async () => {
            accountInfo = await getAccountInfoWithSettledPrice(vault, expiry, 1100.1);
          });

          it('should be initialMargin 110.11', async () => {
            // (-unsettledSellSize * spot + settledRisk) * initialMarginRiskRate + -sellValue
            // sellValue: -0.1
            // (0 + 1100.1) * 0.1 + 0.1
            assert.equal(strFromDecimal(accountInfo.initialMargin), '110.11');
          });

          it('should be marginBalance 1012.325109365048915061', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.572473642777283687
            // sellNotional: 12.752635722271631374
            assert.equal(strFromDecimal(accountInfo.marginBalance), '1012.325109365048915061');
          });

          it('should be available 902.215109365048915061', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '902.215109365048915061');
          });

          it('should be equity 1012.225109365048915061', async () => {
            // marginBalance + buyValue + sellValue
            // sellValue: -0.1
            assert.equal(strFromDecimal(accountInfo.equity), '1012.225109365048915061');
          });

          it('should be equityWithFee 1012.215109365048915061', async () => {
            // equity + fee
            // fee: -0.01 (profitFeeRate)
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '1012.215109365048915061');
          });

          it('should be upnl 12.652635722271631374', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '12.652635722271631374');
          });

          it('should be healthFactor 9.201209975139068403', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '9.201209975139068403');
          });
        });
      });
    });

    context('when put', () => {
      const strike = toDecimalStr(900);
      let vault, config, usdc, optionMarket, accountInfo, signedData;
      const ivs = [[expiry, strike, false, true, toDecimalStr(0.8), false], [expiry, strike, false, false, toDecimalStr(0.8), false]];

      before(async () => {
        ({ vault, config, usdc, optionMarket } = await setup());
        signedData = await createSignedData({ ivs });
        await addPool(config, pool);
        await mintAndDeposit(vault, usdc, pool);
        await mintAndDeposit(vault, usdc, trader2);
        await tradeBySignature(vault, trader2, [expiry, strike, 0, toDecimalStr(1), INT_MAX], now, 0, signedData);
      });

      context('when settled price is 900', () => {
        before(async () => {
          await vault.setTimestamp(expiry);
          await spotPricer.setSettledPrice(expiry, toDecimalStr(900));
          const signedData = await createSignedData({ ivs, nowTime: expiry });
          accountInfo = await withSignedData(vault, signedData).getAccountInfo(trader2.address);
          await vault.setTimestamp(now);
          await spotPricer.setSettledPrice(expiry, 0);
        });

        it('should be initialMargin 0', async () => {
          assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
        });

        it('should be marginBalance 990.150832573222105265', async () => {
          // balance + buyNotional + sellNotional
          // balance: 999.605453787853684211
          // buyNotional: -9.454621214631578946
          assert.equal(strFromDecimal(accountInfo.marginBalance), '990.150832573222105265');
        });

        it('should be available 990.150832573222105265', async () => {
          // marginBalance - initialMargin
          assert.equal(strFromDecimal(accountInfo.available), '990.150832573222105265');
        });

        it('should be equity 990.150832573222105265', async () => {
          // marginBalance + buyValue + sellValue
          // buyValue: 0
          assert.equal(strFromDecimal(accountInfo.equity), '990.150832573222105265');
        });

        it('should be equityWithFee 990.150832573222105265', async () => {
          // equity + fee
          // fee: 0
          assert.equal(strFromDecimal(accountInfo.equityWithFee), '990.150832573222105265');
        });

        it('should be upnl -9.454621214631578946', async () => {
          // buyNotional + buyValue + sellNotional + sellValue
          assert.equal(strFromDecimal(accountInfo.upnl), '-9.454621214631578946');
        });

        it('should be healthFactor INT_MAX', async () => {
          // riskDenominator = initialMargin + buyValue + sellValue;
          // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
          assert.equal(accountInfo.healthFactor, INT_MAX);
        });
      });

      context('when settled price is 890', () => {
        before(async () => {
          accountInfo = await getAccountInfoWithSettledPrice(vault, expiry, 890);
        });

        it('should be initialMargin 0', async () => {
          assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
        });

        it('should be marginBalance 990.150832573222105265', async () => {
          // balance + buyNotional + sellNotional
          // balance: 999.605453787853684211
          // buyNotional: -9.454621214631578946
          assert.equal(strFromDecimal(accountInfo.marginBalance), '990.150832573222105265');
        });

        it('should be available 990.150832573222105265', async () => {
          // marginBalance - initialMargin
          assert.equal(strFromDecimal(accountInfo.available), '990.150832573222105265');
        });

        it('should be equity 1000.150832573222105265', async () => {
          // marginBalance + buyValue + sellValue
          // buyValue: 10
          assert.equal(strFromDecimal(accountInfo.equity), '1000.150832573222105265');
        });

        it('should be equityWithFee 1000.017332573222105265', async () => {
          // equity + fee
          // fee: -0.1335 (exerciseFeeRate)
          assert.equal(strFromDecimal(accountInfo.equityWithFee), '1000.017332573222105265');
        });

        it('should be upnl 0.545378785368421054', async () => {
          // buyNotional + buyValue + sellNotional + sellValue
          assert.equal(strFromDecimal(accountInfo.upnl), '0.545378785368421054');
        });

        it('should be healthFactor 100.015083257322210526', async () => {
          // riskDenominator = initialMargin + buyValue + sellValue;
          // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
          assert.equal(strFromDecimal(accountInfo.healthFactor), '100.015083257322210526');
        });
      });
    });
  });
});
