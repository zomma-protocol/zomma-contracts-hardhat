const assert = require('assert');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');
const { signData, withSignedData, ivsToPrices, getContractFactories, createPool, toDecimalStr, strFromDecimal, createOptionPricer, createSignatureValidator, INT_MAX, toBigNumber, expectRevertCustom } = require('../../support/helper');

let PoolFactory, Pool, PoolToken, Config, OptionMarket, Vault, TestERC20, SpotPricer, accounts;
describe('SignedPool', () => {
  let stakeholderAccount;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer, poolFactory, pool, config, signatureValidator, signedData;

  const createDefaultPool = async (vault, config) => {
    const { pool, poolToken } = await createPool(poolFactory, vault.address, 'NAME', 'SYMBOL');
    await config.addPool(pool.address);
    return { pool, poolToken };
  };

  const setup = async (decimals = 6) => {
    const usdc = await TestERC20.deploy('USDC', 'USDC', decimals);
    const config = await Config.deploy();
    const optionMarket = await OptionMarket.deploy();
    const vault = await Vault.deploy();
    await vault.initialize(config.address, spotPricer.address, optionPricer.address, optionMarket.address, signatureValidator.address);
    await config.initialize(vault.address, ZERO_ADDRESS, ZERO_ADDRESS, usdc.address, decimals);
    await config.setPoolProportion(toDecimalStr(1));
    await config.setInsuranceProportion(toDecimalStr(1));
    await optionMarket.initialize();
    await vault.setTimestamp(now);
    const { pool, poolToken } = (await createDefaultPool(vault, config));
    return { vault, config, pool, poolToken, usdc, optionMarket };
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

  const setupDeposit = async (pool, usdc, from, signedData, decimals = 6) => {
    await usdc.mint(from.address, toDecimalStr(10000, decimals));
    await usdc.connect(from).approve(pool.address, toDecimalStr(100000000000, decimals));
    await withSignedData(pool.connect(from), signedData).deposit(toDecimalStr(1000));
  };

  const setupPosition = async (vault, signedData, usdc, decimals = 6) => {
    await usdc.mint(stakeholderAccount.address, toDecimalStr(1000, decimals));
    await usdc.approve(vault.address, toDecimalStr(100000000000, decimals));
    await withSignedData(vault, signedData).deposit(toDecimalStr(1000));
    await withSignedData(vault, await createSignedData({ nonce: vault.address })).trade([expiry, toDecimalStr(1100), 1, toDecimalStr(10), INT_MAX], now);
  };

  before(async () => {
    [PoolFactory, Pool, PoolToken, Config, OptionMarket, Vault, TestERC20, SpotPricer] = await getContractFactories('SignedPoolFactory', 'SignedPool', 'PoolToken', 'Config', 'TestOptionMarket', 'TestSignedVault', 'TestERC20', 'TestSpotPricer');
    accounts = await ethers.getSigners();
    [stakeholderAccount] = accounts;
    spotPricer = await SpotPricer.deploy();
    poolFactory = await PoolFactory.deploy();
    optionPricer = await createOptionPricer('SignedOptionPricer');
    signatureValidator = await createSignatureValidator();
    ({ pool, config } = await setup());
    signedData = await createSignedData();
  });

  describe('#deposit', () => {
    context('when empty pool', () => {
      context('when quote decimal 6', () => {
        let vault, config, pool, poolToken, usdc;

        before(async () => {
          ({ vault, config, pool, poolToken, usdc } = await setup());
        });

        context('when deposit 1000', () => {
          before(async () => {
            await setupDeposit(pool, usdc, accounts[1], signedData);
          });

          it('should get 1000 shares', async () => {
            assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[1].address)), '1000');
            assert.equal(strFromDecimal(await vault.balanceOf(pool.address)), '1000');
            assert.equal(strFromDecimal(await usdc.balanceOf(accounts[1].address), 6), '9000');
          });
        });

        context('when deposit 0', () => {
          it('should revert with ZeroAmount', async () => {
            await expectRevertCustom(withSignedData(pool.connect(accounts[1]), signedData).deposit(toDecimalStr(0)), Pool, 'ZeroAmount');
          });
        });

        context('when deposit 0.0000001', () => {
          it('should revert with ZeroAmount', async () => {
            await expectRevertCustom(withSignedData(pool.connect(accounts[1]), signedData).deposit(toDecimalStr(0.0000001)), Pool, 'ZeroAmount');
          });
        });

        context('when deposit 0.0000019', () => {
          let pool2, poolToken2;

          before(async () => {
            ({ pool: pool2, poolToken: poolToken2 } = (await createDefaultPool(vault, config)));
            await usdc.mint(accounts[2].address, toDecimalStr(10000, 6));
            await usdc.connect(accounts[2]).approve(pool2.address, toDecimalStr(100000000000, 6));
            await withSignedData(pool2.connect(accounts[2]), signedData).deposit(toDecimalStr('0.0000019'));
          });

          it('should get 0.000001 shares', async () => {
            assert.equal(strFromDecimal(await poolToken2.balanceOf(accounts[2].address)), '0.000001');
            assert.equal(strFromDecimal(await vault.balanceOf(pool2.address)), '0.000001');
            assert.equal(strFromDecimal(await usdc.balanceOf(accounts[2].address), 6), '9999.999999');
          });
        });
      });

      context('when quote decimal 19', () => {
        let vault, pool, poolToken, usdc;

        before(async () => {
          ({ vault, pool, poolToken, usdc } = await setup(19));
          await usdc.mint(accounts[1].address, toDecimalStr(10000, 19));
          await usdc.connect(accounts[1]).approve(pool.address, toDecimalStr(100000000000, 19));
        });

        context('when deposit 0.0000000000000000001', () => {
          it('should revert with ZeroAmount', async () => {
            await expectRevertCustom(withSignedData(pool.connect(accounts[1]), signedData).deposit(toDecimalStr('0.0000000000000000001')), Pool, 'ZeroAmount');
          });
        });

        context('when deposit 0.0000000000000000019', () => {
          before(async () => {
            await withSignedData(pool.connect(accounts[1]), signedData).deposit(toDecimalStr('0.0000000000000000019'));
          });

          it('should get 0.000000000000000001 shares', async () => {
            assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[1].address)), '0.000000000000000001');
            assert.equal(strFromDecimal(await vault.balanceOf(pool.address)), '0.000000000000000001');
            assert.equal(strFromDecimal(await usdc.balanceOf(accounts[1].address), 19), '9999.999999999999999999');
          });
        });
      });
    });

    context('when totalSupply 1000', () => {
      const subSetup = async (decimals) => {
        const { vault, config, pool, poolToken, usdc, optionMarket } = (await setup(decimals));
        await setupDeposit(pool, usdc, accounts[1], signedData, decimals);
        await usdc.mint(accounts[2].address, toDecimalStr(10000, decimals));
        await usdc.connect(accounts[2]).approve(pool.address, toDecimalStr(100000000000, decimals));
        return { vault, config, pool, poolToken, usdc, optionMarket };
      };

      context('when decimals 6', () => {
        let vault, config, pool, poolToken, usdc, optionMarket;
        decimals = 6;

        beforeEach(async () => {
          ({ vault, config, pool, poolToken, usdc, optionMarket } = await subSetup(decimals));
        });

        context('when share price 1', () => {
          beforeEach(async () => {
            await withSignedData(pool.connect(accounts[2]), signedData).deposit(toDecimalStr(200));
          });

          it('should get 200 shares', async () => {
            assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '200');
            assert.equal(strFromDecimal(await vault.balanceOf(pool.address)), '1200');
            assert.equal(strFromDecimal(await usdc.balanceOf(accounts[2].address), 6), '9800');
          });
        });

        // equity: 1013.942729797474999860
        context('when share price 1.013942729797474999', () => {
          beforeEach(async () => {
            await setupPosition(vault, signedData, usdc, decimals);
            await withSignedData(pool.connect(accounts[2]), signedData).deposit(toDecimalStr(200));
          });

          // 200 * 1000 / 1013.942729797474999860
          it('should get 197.249799345124764235 shares', async () => {
            assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '197.249799345124764235');
          });
        });

        // initialMargin: 1418.973431100000000000
        // marginBalance: 1141.554739097474999860
        // equity: 792.581307997474999860
        // max bonus part: 277.41869200252500014
        // hf: 0.740730194390163551
        context('when share price 0.792581307997474999', () => {
          let signedData2;

          beforeEach(async () => {
            await setupPosition(vault, signedData, usdc, decimals);
            signedData2 = await createSignedData({ spot: toDecimalStr(1070) });
          });

          context('when zlm', () => {
            beforeEach(async () => {
              await pool.setZlmRate(toDecimalStr('0.740730194390163552'));
            });

            context('when all bonus', () => {
              beforeEach(async () => {
                await withSignedData(pool.connect(accounts[2]), signedData2).deposit(toDecimalStr(200));
              });

              // (200 * 1.06) * 1000 / 792.581307997474999860
              it('should get 267.480443786437855481 shares', async () => {
                assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '267.480443786437855481');
              });
            });

            context('when partial bonus', () => {
              beforeEach(async () => {
                await withSignedData(pool.connect(accounts[2]), signedData2).deposit(toDecimalStr(2000));
              });

              // (277.41869200252500014 * 1.06 + (2000 - 277.41869200252500014)) * 1000 / 792.581307997474999860
              it('should get 2544.401566339457647566 shares', async () => {
                assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '2544.401566339457647566');
              });
            });
          });

          context('when not zlm', () => {
            beforeEach(async () => {
              await pool.setZlmRate(toDecimalStr('0.740730194390163551'));
              await withSignedData(pool.connect(accounts[2]), signedData2).deposit(toDecimalStr(200));
            });

            // 200 * 1000 / 792.583060234858968950
            it('should get 252.34004130796024102 shares', async () => {
              assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '252.34004130796024102');
            });
          });
        });
      });

      context('when decimals 19', () => {
        let vault, pool, poolToken, usdc, optionMarket;
        const decimals = 19;

        before(async () => {
          ({ vault, pool, poolToken, usdc, optionMarket } = await subSetup(decimals));
        });

        context('when share price 1.00966629982777164', () => {
          before(async () => {
            await setupPosition(vault, signedData, usdc, decimals);
          });

          context('when deposit 0.000000000000000002', () => {
            before(async () => {
              await withSignedData(pool.connect(accounts[2]), signedData).deposit(toDecimalStr('0.000000000000000002'));
            });

            it('should get 0.000000000000000001 shares', async () => {
              assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '0.000000000000000001');
            });
          });

          context('when deposit 0.000000000000000001', () => {
            it('should revert with ZeroShare', async () => {
              await expectRevertCustom(withSignedData(pool.connect(accounts[2]), signedData).deposit(toDecimalStr('0.000000000000000001')), Pool, 'ZeroShare');
            });
          });
        });
      });
    });

    context('when bankruptcy ', () => {
      let vault, pool, usdc, optionMarket, signedData2;

      before(async () => {
        ({ vault, pool, usdc, optionMarket } = await setup());
        await setupDeposit(pool, usdc, accounts[1], signedData);
        await setupPosition(vault, signedData, usdc);
        signedData2 = await createSignedData({ spot: toDecimalStr(1200) });
      });

      context('when before clear', () => {
        it('should revert with Bankruptcy', async () => {
          await expectRevertCustom(withSignedData(pool.connect(accounts[1]), signedData2).deposit(toDecimalStr(1000)), Pool, 'Bankruptcy');
        });
      });

      context('when after clear', () => {
        before(async () => {
          await withSignedData(vault, signedData2).clear(pool.address);
        });

        it('should revert with Bankruptcy', async () => {
          await expectRevertCustom(withSignedData(pool.connect(accounts[1]), signedData2).deposit(toDecimalStr(1000)), Pool, 'Bankruptcy');
        });
      });
    });
  });

  describe('#withdraw', () => {
    context('when no position', () => {
      let vault, config, pool, poolToken, usdc;

      before(async () => {
        ({ vault, config, pool, poolToken, usdc } = await setup());
      });

      context('when withdraw all', () => {
        before(async () => {
          await setupDeposit(pool, usdc, accounts[1], signedData);
          await withSignedData(pool.connect(accounts[1]), signedData).withdraw(toDecimalStr(1000), '0');
        });

        it('should get all', async () => {
          assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[1].address)), '0');
          assert.equal(strFromDecimal(await vault.balanceOf(pool.address)), '0');
          assert.equal(strFromDecimal(await usdc.balanceOf(accounts[1].address), 6), '10000');
        });
      });

      context('when withdraw partial', () => {
        before(async () => {
          await setupDeposit(pool, usdc, accounts[2], signedData);
          await withSignedData(pool.connect(accounts[2]), signedData).withdraw(toDecimalStr(100), '0');
        });

        it('should have fee', async () => {
          assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '900');
          assert.equal(strFromDecimal(await vault.balanceOf(pool.address)), '900.1');
          assert.equal(strFromDecimal(await usdc.balanceOf(accounts[2].address), 6), '9099.9');
        });
      });
    });

    context('when position', () => {
      const subSetup = async () => {
        const { vault, config, pool, poolToken, usdc, optionMarket } = (await setup());
        await setupDeposit(pool, usdc, accounts[1], signedData);
        await setupPosition(vault, signedData, usdc);
        const accountInfo = await withSignedData(vault, signedData).getAccountInfo(pool.address);
        const sharePrice = toBigNumber(accountInfo.equity).div(1000);
        return { vault, config, pool, poolToken, usdc, sharePrice, optionMarket }
      };

      context('when withdraw under freeWithdrawableRate', () => {
        let vault, config, pool, poolToken, usdc;
        let sharePrice, sharePrice2;

        before(async () => {
          ({ vault, config, pool, poolToken, usdc, sharePrice } = await subSetup());
          await pool.setFreeWithdrawableRate(toDecimalStr(0.99));
          await withSignedData(pool.connect(accounts[1]), signedData).withdraw(toDecimalStr(1), '0');
          const accountInfo = await withSignedData(vault, signedData).getAccountInfo(pool.address);
          sharePrice2 = toBigNumber(accountInfo.equity).div(999);
        });

        it('should not reduce position', async () => {
          assert.equal(sharePrice2.gte(sharePrice), true);
          assert.equal(strFromDecimal(await vault.positionSizeOf(pool.address, expiry, strike, true)), '-10');
          assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[1].address)), '999');
          assert.equal(strFromDecimal(await usdc.balanceOf(accounts[1].address), 6), '9001.012928');
        });
      });

      context('when withdraw over freeWithdrawableRate', () => {
        let vault, config, pool, poolToken, usdc;
        let sharePrice, sharePrice2;

        before(async () => {
          ({ vault, config, pool, poolToken, usdc, sharePrice } = await subSetup());
        });

        context('when other pool not available', () => {
          it('should revert with Unavailable', async () => {
            await expectRevertCustom(withSignedData(pool.connect(accounts[1]), signedData).withdraw(toDecimalStr(1), '0'), optionPricer, 'Unavailable');
          });
        });

        context('when other pool available', () => {
          before(async () => {
            let { pool: pool2 } = (await createDefaultPool(vault, config));
            await setupDeposit(pool2, usdc, accounts[3], signedData);
          });

          context('when unacceptable', () => {
            it('should revert with "unacceptable amount"', async () => {
              await expectRevertCustom(withSignedData(pool.connect(accounts[1]), signedData).withdraw(toDecimalStr(1), toDecimalStr('1.008650173069400929')), Vault, 'UnacceptableAmount');
            });
          });

          context('when acceptable', () => {
            before(async () => {
              await withSignedData(pool.connect(accounts[1]), signedData).withdraw(toDecimalStr(1), toDecimalStr('1.008650173069400928'));
              const accountInfo = await withSignedData(vault, signedData).getAccountInfo(pool.address);
              sharePrice2 = toBigNumber(accountInfo.equity).div(999);
            });

            // remove size: 0.00999
            it('should reduce position', async () => {
              assert.equal(sharePrice2.gte(sharePrice), true);
              assert.equal(strFromDecimal(await vault.positionSizeOf(pool.address, expiry, strike, true)), '-9.99001');
              assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[1].address)), '999');
              assert.equal(strFromDecimal(await usdc.balanceOf(accounts[1].address), 6), '9001.00865');
            });
          });
        });
      });
    });
  });
});
