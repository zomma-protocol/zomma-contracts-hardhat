const assert = require('assert');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal, INT_MAX, createOptionPricer } = require('./support/helper');

let Vault, Config, accounts;
describe('OptionPricer', () => {
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  let optionPricer, config, vault;

  const getPremiumParams = (params = {}) => {
    return {
      now: now,
      spot: toDecimalStr(1000),
      riskFreeRate: toDecimalStr(0.06),
      initialMarginRiskRate: toDecimalStr(0.1),
      spotFee: toDecimalStr(0.0003),
      optionFee: toDecimalStr(0.01),
      minPremium: toDecimalStr(1),
      expiry: expiry,
      strike: toDecimalStr(1100),
      iv: toDecimalStr(0.8),
      size: toDecimalStr(1),
      available: INT_MAX,
      equity: 0,
      priceRatio: toDecimalStr(0.1),
      priceRatio2: toDecimalStr(1),
      priceRatioUtilization: toDecimalStr(0.95),
      isCall: true,
      ...params
    };
  };

  before(async () => {
    [Vault, Config] = await getContractFactories('TestVault', 'Config');
    accounts = await ethers.getSigners();
    optionPricer = await createOptionPricer(artifacts);
    config = await Config.deploy();
    vault = await Vault.deploy();
    await config.initialize(ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, ZERO_ADDRESS, 6);
    await optionPricer.initialize(config.address);
    await optionPricer.setVault(vault.address);
  });

  describe('#initialize', () => {
    context('when initialize once', () => {
      it('should pass', async () => {
        assert.equal(await optionPricer.initialized(), true);
        assert.equal(await optionPricer.config(), config.address);
      });
    });

    context('when initialize twice', () => {
      it('should revert with "already initialized"', async () => {
        await expectRevert(optionPricer.initialize(accounts[1].address), 'already initialized');
      });
    });
  });

  describe('#updateLookup', () => {
    context('when 7 days to expire', () => {
      before(async () => {
        await vault.setTimestamp(now);
      });

      it('should update sqrtTs and pvs', async () => {
        await optionPricer.updateLookup([expiry]);
        assert.equal(strFromDecimal(await optionPricer.sqrtTs(expiry)), '0.138484952943562864');
        assert.equal(strFromDecimal(await optionPricer.pvs(expiry)), '0.998849976852539634');
      });
    });

    context('when expired', () => {
      before(async () => {
        await vault.setTimestamp(now + 1);
        await optionPricer.updateLookup([now]);
      });

      it('should update sqrtTs and pvs', async () => {
        assert.equal(strFromDecimal(await optionPricer.sqrtTs(now)), '0');
        assert.equal(strFromDecimal(await optionPricer.pvs(now)), '1');
      });
    });
  });

  describe('#getPrice', () => {
    function getPrice(isCall, spot, strike) {
      return optionPricer.getPrice(isCall, expiry, expiry - now, toDecimalStr(0.8), spot, strike, toDecimalStr(0.06));
    }

    before(async () => {
      await vault.setTimestamp(now);
      await optionPricer.updateLookup([expiry]);
    });

    context('when strike 1100', () => {
      const strike = toDecimalStr(1100);

      context('when spot 1000', () => {
        const spot = toDecimalStr(1000);

        it('should get call price 12.760791851843752114', async () => {
          assert.equal(strFromDecimal(await getPrice(true, spot, strike)), '12.760791851843752114');
        });

        it('should get put price 111.495766389637349514', async () => {
          assert.equal(strFromDecimal(await getPrice(false, spot, strike)), '111.495766389637349514');
        });
      });

      context('when spot 500', () => {
        const spot = toDecimalStr(500);

        it('should get call price 0', async () => {
          assert.equal(strFromDecimal(await getPrice(true, spot, strike)), '0');
        });

        it('should get put price 598.7349745377935974', async () => {
          assert.equal(strFromDecimal(await getPrice(false, spot, strike)), '598.7349745377935974');
        });
      });

      context('when spot 1800', () => {
        const spot = toDecimalStr(1800);

        it('should get call price 701.2650254622064026', async () => {
          assert.equal(strFromDecimal(await getPrice(true, spot, strike)), '701.2650254622064026');
        });

        it('should get put price 0', async () => {
          assert.equal(strFromDecimal(await getPrice(false, spot, strike)), '0');
        });
      });
    });
  });

  describe('#getPremium', () => {
    async function getPremium(params) {
      const premiumParams = getPremiumParams(params);
      const result = await optionPricer.getPremium(premiumParams);
      return [result[0], result[1]];
    }

    async function assertGetPremium(params, expectedPremium, expectedFee) {
      const [premium, fee] = await getPremium(params);
      assert.equal(strFromDecimal(premium), expectedPremium);
      assert.equal(strFromDecimal(fee), expectedFee);
    }

    before(async () => {
      await vault.setTimestamp(now);
      await optionPricer.updateLookup([expiry]);
    });

    context('when buy', () => {
      context('when spot 1000', () => {
        context('when no fee', () => {
          const subParams = {
            spotFee: toDecimalStr(0),
            optionFee: toDecimalStr(0),
          };

          context('when available INT256_MAX', () => {
            context('when minPremium 0', () => {
              const minPremium = toDecimalStr(0);

              it('should get premium -12.760791851843752114 and fee 0', async () => {
                await assertGetPremium({ ...subParams, minPremium }, '-12.760791851843752114', '0');
              });
            });

            context('when minPremium 13', () => {
              const minPremium = toDecimalStr(13);

              it('should get premium -13 and fee 0', async () => {
                await assertGetPremium({ ...subParams, minPremium }, '-13', '0');
              });
            });
          });

          context('when utilization 0% to 10%', () => {
            const available = toDecimalStr(1000);
            const equity = toDecimalStr(1000);

            it('should get premium -12.827953914221877123 and fee 0', async () => {
              await assertGetPremium({ ...subParams, available, equity }, '-12.827953914221877123', '0');
            });
          });

          context('when utilization 99% to 99.1%', () => {
            const available = toDecimalStr(1000);
            const equity = toDecimalStr(100000);

            it('should get premium -23.339488297022222616 and fee 0', async () => {
              await assertGetPremium({ ...subParams, available, equity }, '-23.339488297022222616', '0');
            });
          });

          context('when utilization 94.9% to 95%', () => {
            const available = toDecimalStr(5100);
            const equity = toDecimalStr(100000);

            it('should get premium -14.036199416404346067 and fee 0', async () => {
              await assertGetPremium({ ...subParams, available, equity }, '-14.036199416404346067', '0');
            });
          });

          context('when utilization 94.901% to 95.001%', () => {
            const available = toDecimalStr(5099);
            const equity = toDecimalStr(100000);

            it('should get premium -14.03622426636741725 and fee 0', async () => {
              await assertGetPremium({ ...subParams, available, equity }, '-14.03622426636741725', '0');
            });
          });

          context('when available 0', () => {
            const available = toDecimalStr(0);
            const equity = toDecimalStr(100000);

            it('should revert with "available must be greater than 0"', async () => {
              await expectRevert(getPremium({ ...subParams, available, equity }), 'available must be greater than 0');
            });
          });

          context('when available > equity', () => {
            const available = toDecimalStr(1001);
            const equity = toDecimalStr(1000);

            it('should revert with "equity < available"', async () => {
              await expectRevert(getPremium({ ...subParams, available, equity }), 'equity < available');
            });
          });
        });

        context('when spot fee 0.03% and optionFee 1%', () => {
          context('when available INT256_MAX', () => {
            context('when minPremium 0', () => {
              const minPremium = toDecimalStr(0);

              it('should get premium -12.760791851843752114 and fee -0.427607918518437521', async () => {
                await assertGetPremium({ minPremium }, '-12.760791851843752114', '-0.427607918518437521');
              });
            });

            context('when minPremium 13', () => {
              const minPremium = toDecimalStr(13);

              it('should get premium -13 and fee -0.43', async () => {
                await assertGetPremium({ minPremium }, '-13', '-0.43');
              });
            });

            context('when iv 0', () => {
              it('should revert with "iv is 0"', async () => {
                await expectRevert(getPremium({ iv: '0' }), 'iv is 0');
              });
            });
          });
        });
      });
    });

    context('when sell', () => {
      context('when spot 1000', () => {
        context('when no fee', () => {
          const subParams = {
            size: toDecimalStr(-1),
            spotFee: toDecimalStr(0),
            optionFee: toDecimalStr(0),
          };

          context('when available INT256_MAX', () => {
            context('when minPremium 0', () => {
              const minPremium = toDecimalStr(0);

              it('should get premium 12.760791851843752114 and fee 0', async () => {
                await assertGetPremium({ ...subParams, minPremium }, '12.760791851843752114', '0');
              });
            });

            context('when minPremium 13', () => {
              const minPremium = toDecimalStr(13);

              it('should get premium 12.760791851843752114 and fee 0', async () => {
                await assertGetPremium({ ...subParams, minPremium }, '12.760791851843752114', '0');
              });
            });
          });

          context('when available 1000 and equity 1000', () => {
            const available = toDecimalStr(1000);
            const equity = toDecimalStr(1000);

            it('should get premium -12.827953914221877123 and fee 0', async () => {
              await assertGetPremium({ ...subParams, available, equity }, '12.752227193061747764', '0');
            });
          });
        });
      });
    });

    context('when spot 500', () => {
      context('when spot fee 0.03% and optionFee 1%', () => {
        const subParams = {
          spot: toDecimalStr(500),
          size: toDecimalStr(-1)
        };

        it('should get premium 0 and fee 0', async () => {
          await assertGetPremium({ ...subParams }, '0', '0');
        });
      });
    });
  });
});
