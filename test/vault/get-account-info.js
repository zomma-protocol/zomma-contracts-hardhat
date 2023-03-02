const assert = require('assert');
const { getContractFactories, toDecimalStr, strFromDecimal, createOptionPricer, buildIv, addPool, mintAndDeposit, INT_MAX } = require('../support/helper');

let Vault, Config, TestERC20, SpotPricer, accounts;
describe('Vault', () => {
  let stakeholderAccount, insuranceAccount, trader, trader2, pool;
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
    await config.initialize(vault.address, stakeholderAccount.address, insuranceAccount.address, usdc.address, decimals);
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
    [stakeholderAccount, insuranceAccount, trader, trader2, pool] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer(artifacts);
  });

  describe('#getAccountInfo', () => {
    let vault, config, usdc;

    const getAccountInfoWithSettledPrice = async (vault, expiry, settledPrice) => {
      await vault.setTimestamp(expiry);
      await spotPricer.setSettledPrice(expiry, toDecimalStr(settledPrice));
      const accountInfo = await vault.getAccountInfo(trader2.address);
      await vault.setTimestamp(now);
      await spotPricer.setSettledPrice(expiry, 0);
      return accountInfo;
    }

    before(async () => {
      ({ vault, config, usdc } = await setup());
      await setupMarket(vault);
    });

    context('when empty', () => {
      let accountInfo;

      before(async () => {
        accountInfo = await vault.getAccountInfo(trader.address);
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
        accountInfo = await vault.getAccountInfo(trader.address);
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
          await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(1), INT_MAX);
          accountInfo = await vault.getAccountInfo(trader2.address);
        });

        context('when price is unsettled', () => {
          it('should be initialMargin 0', async () => {
            assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
          });

          it('should be marginBalance 986.743766546635904106', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.571720460857781229
            // buyNotional: -12.827953914221877123
            assert.equal(strFromDecimal(accountInfo.marginBalance), '986.743766546635904106');
          });

          it('should be available 986.743766546635904106', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '986.743766546635904106');
          });

          it('should be equity 999.50455839847965622', async () => {
            // marginBalance + buyValue + sellValue
            // buyValue: 12.760791851843752114
            assert.equal(strFromDecimal(accountInfo.equity), '999.50455839847965622');
          });

          it('should be equityWithFee 999.076950479961218699', async () => {
            // equity + fee
            // fee: -0.427607918518437521
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '999.076950479961218699');
          });

          it('should be upnl -0.067162062378125009', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '-0.067162062378125009');
          });

          it('should be healthFactor 78.326217526545229798', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '78.326217526545229798');
          });
        });

        context('when settled price is 1100', () => {
          before(async () => {
            accountInfo = await getAccountInfoWithSettledPrice(vault, expiry, 1100);
          });

          it('should be initialMargin 0', async () => {
            assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
          });

          it('should be marginBalance 986.743766546635904106', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.571720460857781229
            // buyNotional: -12.827953914221877123
            assert.equal(strFromDecimal(accountInfo.marginBalance), '986.743766546635904106');
          });

          it('should be available 986.743766546635904106', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '986.743766546635904106');
          });

          it('should be equity 986.743766546635904106', async () => {
            // marginBalance + buyValue + sellValue
            // buyValue: 0
            assert.equal(strFromDecimal(accountInfo.equity), '986.743766546635904106');
          });

          it('should be equityWithFee 986.743766546635904106', async () => {
            // equity + fee
            // fee: 0
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '986.743766546635904106');
          });

          it('should be upnl -12.827953914221877123', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '-12.827953914221877123');
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

          it('should be marginBalance 986.743766546635904106', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.571720460857781229
            // buyNotional: -12.827953914221877123
            assert.equal(strFromDecimal(accountInfo.marginBalance), '986.743766546635904106');
          });

          it('should be available 986.743766546635904106', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '986.743766546635904106');
          });

          it('should be equity 996.743766546635904106', async () => {
            // marginBalance + buyValue + sellValue
            // buyValue: 10
            assert.equal(strFromDecimal(accountInfo.equity), '996.743766546635904106');
          });

          it('should be equityWithFee 996.577266546635904106', async () => {
            // equity + fee
            // fee: -0.1665 (exerciseFeeRate)
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '996.577266546635904106');
          });

          it('should be upnl -2.827953914221877123', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '-2.827953914221877123');
          });

          it('should be healthFactor 99.67437665466359041', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '99.67437665466359041');
          });
        });

        context('when settled price is 1100.1', () => {
          before(async () => {
            accountInfo = await getAccountInfoWithSettledPrice(vault, expiry, 1100.1);
          });

          it('should be initialMargin 0', async () => {
            assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
          });

          it('should be marginBalance 986.743766546635904106', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.571720460857781229
            // buyNotional: -12.827953914221877123
            assert.equal(strFromDecimal(accountInfo.marginBalance), '986.743766546635904106');
          });

          it('should be available 986.743766546635904106', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '986.743766546635904106');
          });

          it('should be equity 986.843766546635904106', async () => {
            // marginBalance + buyValue + sellValue
            // buyValue: 0.1
            assert.equal(strFromDecimal(accountInfo.equity), '986.843766546635904106');
          });

          it('should be equityWithFee 986.833766546635904106', async () => {
            // equity + fee
            // fee: -0.01 (profitFeeRate)
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '986.833766546635904106');
          });

          it('should be upnl -12.727953914221877123', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '-12.727953914221877123');
          });

          it('should be healthFactor 9868.43766546635904106', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '9868.43766546635904106');
          });
        });
      });

      context('when size is -1', () => {
        let vault, config, usdc, accountInfo;

        before(async () => {
          ({ vault, config, usdc } = await setup());
          await setupMarket(vault);

          await addPool(config, pool);
          await mintAndDeposit(vault, usdc, pool);
          await mintAndDeposit(vault, usdc, trader2);
          await vault.connect(trader2).trade(expiry, strike, true, toDecimalStr(-1), 0);
          accountInfo = await vault.getAccountInfo(trader2.address);
        });

        context('when price is unsettled', () => {
          it('should be initialMargin 112.760791851843752114', async () => {
            // (-unsettledSellSize * spot + settledRisk) * initialMarginRiskRate + -sellValue
            // sellValue: -12.760791851843752114
            // (1 * 1000 + 0) * 0.1 + 12.760791851843752114
            assert.equal(strFromDecimal(accountInfo.initialMargin), '112.760791851843752114');
          });

          it('should be marginBalance 1012.324704921131130287', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.572477728069382523
            // sellNotional: 12.752227193061747764
            assert.equal(strFromDecimal(accountInfo.marginBalance), '1012.324704921131130287');
          });

          it('should be available 899.563913069287378173', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '899.563913069287378173');
          });

          it('should be equity 999.563913069287378173', async () => {
            // marginBalance + buyValue + sellValue
            // sellValue: -12.760791851843752114
            assert.equal(strFromDecimal(accountInfo.equity), '999.563913069287378173');
          });

          it('should be equityWithFee 999.136305150768940652', async () => {
            // equity + fee
            // fee: -0.427607918518437521
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '999.136305150768940652');
          });

          it('should be upnl -0.00856465878200435', async () => {
            // sellNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '-0.00856465878200435');
          });

          it('should be healthFactor 9.995639130692873781', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '9.995639130692873781');
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

          it('should be marginBalance 1012.324704921131130287', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.572477728069382523
            // sellNotional: 12.752227193061747764
            assert.equal(strFromDecimal(accountInfo.marginBalance), '1012.324704921131130287');
          });

          it('should be available 902.324704921131130287', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '902.324704921131130287');
          });

          it('should be equity 1012.324704921131130287', async () => {
            // marginBalance + buyValue + sellValue
            // sellValue: 0
            assert.equal(strFromDecimal(accountInfo.equity), '1012.324704921131130287');
          });

          it('should be equityWithFee 1012.324704921131130287', async () => {
            // equity + fee
            // fee: 0
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '1012.324704921131130287');
          });

          it('should be upnl 12.752227193061747764', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '12.752227193061747764');
          });

          it('should be healthFactor 9.202951862919373911', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '9.202951862919373911');
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

          it('should be marginBalance 1012.324704921131130287', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.572477728069382523
            // sellNotional: 12.752227193061747764
            assert.equal(strFromDecimal(accountInfo.marginBalance), '1012.324704921131130287');
          });

          it('should be available 891.324704921131130287', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '891.324704921131130287');
          });

          it('should be equity 1002.324704921131130287', async () => {
            // marginBalance + buyValue + sellValue
            // sellValue: -10
            assert.equal(strFromDecimal(accountInfo.equity), '1002.324704921131130287');
          });

          it('should be equityWithFee 1002.158204921131130287', async () => {
            // equity + fee
            // fee: -0.1665 (exerciseFeeRate)
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '1002.158204921131130287');
          });

          it('should be upnl 2.752227193061747764', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '2.752227193061747764');
          });

          it('should be healthFactor 9.029952296586766939', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '9.029952296586766939');
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

          it('should be marginBalance 1012.324704921131130287', async () => {
            // balance + buyNotional + sellNotional
            // balance: 999.572477728069382523
            // sellNotional: 12.752227193061747764
            assert.equal(strFromDecimal(accountInfo.marginBalance), '1012.324704921131130287');
          });

          it('should be available 902.214704921131130287', async () => {
            // marginBalance - initialMargin
            assert.equal(strFromDecimal(accountInfo.available), '902.214704921131130287');
          });

          it('should be equity 1012.224704921131130287', async () => {
            // marginBalance + buyValue + sellValue
            // sellValue: -0.1
            assert.equal(strFromDecimal(accountInfo.equity), '1012.224704921131130287');
          });

          it('should be equityWithFee 1012.214704921131130287', async () => {
            // equity + fee
            // fee: -0.01 (profitFeeRate)
            assert.equal(strFromDecimal(accountInfo.equityWithFee), '1012.214704921131130287');
          });

          it('should be upnl 12.652227193061747764', async () => {
            // buyNotional + buyValue + sellNotional + sellValue
            assert.equal(strFromDecimal(accountInfo.upnl), '12.652227193061747764');
          });

          it('should be healthFactor 9.201206298710400238', async () => {
            // riskDenominator = initialMargin + buyValue + sellValue;
            // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
            assert.equal(strFromDecimal(accountInfo.healthFactor), '9.201206298710400238');
          });
        });
      });
    });

    context('when put', () => {
      const strike = toDecimalStr(900);
      let vault, config, usdc, accountInfo;

      before(async () => {
        ({ vault, config, usdc } = await setup());
        await setupMarket(vault, [[expiry, strike, false, true, toDecimalStr(0.8), false], [expiry, strike, false, false, toDecimalStr(0.8), false]]);

        await addPool(config, pool);
        await mintAndDeposit(vault, usdc, pool);
        await mintAndDeposit(vault, usdc, trader2);
        await vault.connect(trader2).trade(expiry, strike, false, toDecimalStr(1), INT_MAX);
      });

      context('when settled price is 900', () => {
        before(async () => {
          await vault.setTimestamp(expiry);
          await spotPricer.setSettledPrice(expiry, toDecimalStr(900));
          accountInfo = await vault.getAccountInfo(trader2.address);
          await vault.setTimestamp(now);
          await spotPricer.setSettledPrice(expiry, 0);
        });

        it('should be initialMargin 0', async () => {
          assert.equal(strFromDecimal(accountInfo.initialMargin), '0');
        });

        it('should be marginBalance 990.150891671475143767', async () => {
          // balance + buyNotional + sellNotional
          // balance: 999.605454372984902414
          // buyNotional: -9.454562701509758647
          assert.equal(strFromDecimal(accountInfo.marginBalance), '990.150891671475143767');
        });

        it('should be available 990.150891671475143767', async () => {
          // marginBalance - initialMargin
          assert.equal(strFromDecimal(accountInfo.available), '990.150891671475143767');
        });

        it('should be equity 990.150891671475143767', async () => {
          // marginBalance + buyValue + sellValue
          // buyValue: 0
          assert.equal(strFromDecimal(accountInfo.equity), '990.150891671475143767');
        });

        it('should be equityWithFee 990.150891671475143767', async () => {
          // equity + fee
          // fee: 0
          assert.equal(strFromDecimal(accountInfo.equityWithFee), '990.150891671475143767');
        });

        it('should be upnl -9.454562701509758647', async () => {
          // buyNotional + buyValue + sellNotional + sellValue
          assert.equal(strFromDecimal(accountInfo.upnl), '-9.454562701509758647');
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

        it('should be marginBalance 990.150891671475143767', async () => {
          // balance + buyNotional + sellNotional
          // balance: 999.605454372984902414
          // buyNotional: -9.454562701509758647
          assert.equal(strFromDecimal(accountInfo.marginBalance), '990.150891671475143767');
        });

        it('should be available 990.150891671475143767', async () => {
          // marginBalance - initialMargin
          assert.equal(strFromDecimal(accountInfo.available), '990.150891671475143767');
        });

        it('should be equity 1000.150891671475143767', async () => {
          // marginBalance + buyValue + sellValue
          // buyValue: 10
          assert.equal(strFromDecimal(accountInfo.equity), '1000.150891671475143767');
        });

        it('should be equityWithFee 1000.017391671475143767', async () => {
          // equity + fee
          // fee: -0.1335 (exerciseFeeRate)
          assert.equal(strFromDecimal(accountInfo.equityWithFee), '1000.017391671475143767');
        });

        it('should be upnl 0.545437298490241353', async () => {
          // buyNotional + buyValue + sellNotional + sellValue
          assert.equal(strFromDecimal(accountInfo.upnl), '0.545437298490241353');
        });

        it('should be healthFactor 100.015089167147514376', async () => {
          // riskDenominator = initialMargin + buyValue + sellValue;
          // healthFactor = riskDenominator == 0 ? INT256_MAX : equity / riskDenominator
          assert.equal(strFromDecimal(accountInfo.healthFactor), '100.015089167147514376');
        });
      });
    });
  });
});
