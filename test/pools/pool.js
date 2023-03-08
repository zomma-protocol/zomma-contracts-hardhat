const assert = require('assert');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');
const { getContractFactories, expectRevert, createPool, toDecimalStr, strFromDecimal, createOptionPricer, buildIv, mergeIv, INT_MAX, toBigNumber } = require('../support/helper');

let PoolFactory, Pool, PoolToken, Config, Vault, TestERC20, SpotPricer, accounts;
describe('Pool', () => {
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let spotPricer, optionPricer, poolFactory, pool, config;

  const createDefaultPool = async (vault, config) => {
    const { pool, poolToken } = await createPool(poolFactory, vault.address, 'NAME', 'SYMBOL');
    await config.addPool(pool.address);
    return { pool, poolToken };
  };

  const setup = async (decimals = 6) => {
    const usdc = await TestERC20.deploy('USDC', 'USDC', decimals);
    const config = await Config.deploy();
    const vault = await Vault.deploy();
    await vault.initialize(config.address, spotPricer.address, optionPricer.address);
    await config.initialize(vault.address, ZERO_ADDRESS, ZERO_ADDRESS, usdc.address, decimals);
    await config.setPoolProportion(toDecimalStr(1));
    await config.setInsuranceProportion(toDecimalStr(1));
    await optionPricer.reinitialize(config.address, vault.address);
    const { pool, poolToken } = (await createDefaultPool(vault, config));
    return { vault, config, pool, poolToken, usdc };
  };

  const setupDeposit = async (pool, usdc, from, decimals = 6) => {
    await usdc.mint(from.address, toDecimalStr(10000, decimals));
    await usdc.connect(from).approve(pool.address, toDecimalStr(100000000000, decimals));
    await pool.connect(from).deposit(toDecimalStr(1000));
  };

  const setupPosition = async (vault, usdc, decimals = 6) => {
    await vault.setTimestamp(now);
    await spotPricer.setPrice(toDecimalStr(1000));
    await usdc.mint(accounts[0].address, toDecimalStr(1000, decimals));
    await usdc.approve(vault.address, toDecimalStr(100000000000, decimals));
    await vault.deposit(toDecimalStr(1000));
    await vault.setIv(mergeIv([
      buildIv(expiry, strike, true, true, toDecimalStr(0.8), false),
      buildIv(expiry, strike, true, false, toDecimalStr(0.8), false)
    ]));
    await optionPricer.updateLookup([expiry]);
    await vault.trade(expiry, toDecimalStr(1100), true, toDecimalStr(10), INT_MAX);
  };

  before(async () => {
    [PoolFactory, Pool, PoolToken, Config, Vault, TestERC20, SpotPricer] = await getContractFactories('PoolFactory', 'Pool', 'PoolToken', 'Config', 'TestVault', 'TestERC20', 'TestSpotPricer');
    accounts = await ethers.getSigners();
    spotPricer = await SpotPricer.deploy();
    poolFactory = await PoolFactory.deploy();
    optionPricer = await createOptionPricer(artifacts);
    ({ pool, config } = await setup());
  });

  describe('#initialize', () => {
    context('when initialize once', () => {
      it('should pass', async () => {
        assert.equal(await pool.initialized(), true);
      });
    });

    context('when initialize twice', () => {
      it('should revert with "already initialized"', async () => {
        await expectRevert(pool.initialize(accounts[1].address, accounts[1].address, accounts[1].address), 'already initialized');
      });
    });
  });

  describe('#setReservedRate', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await pool.setReservedRate(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.poolReservedRate(pool.address)), '0');
        });
      });

      context('when set 1', () => {
        before(async () => {
          await pool.setReservedRate(toDecimalStr(1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await config.poolReservedRate(pool.address)), '1');
        });
      });

      context('when set 1.000000000000000001', () => {
        it('should revert with "exceed the limit"', async () => {
          await expectRevert(pool.setReservedRate(toDecimalStr('1.000000000000000001')), 'exceed the limit');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(pool.connect(accounts[1]).setReservedRate(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setZlmRate', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await pool.setZlmRate(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await pool.zlmRate()), '0');
        });
      });

      context('when set 1', () => {
        before(async () => {
          await pool.setZlmRate(toDecimalStr(1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await pool.zlmRate()), '1');
        });
      });

      context('when set 1.000000000000000001', () => {
        it('should revert with "exceed the limit"', async () => {
          await expectRevert(pool.setZlmRate(toDecimalStr('1.000000000000000001')), 'exceed the limit');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(pool.connect(accounts[1]).setZlmRate(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setBonusRate', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await pool.setBonusRate(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await pool.bonusRate()), '0');
        });
      });

      context('when set 1', () => {
        before(async () => {
          await pool.setBonusRate(toDecimalStr(1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await pool.bonusRate()), '1');
        });
      });

      context('when set 1.000000000000000001', () => {
        it('should revert with "exceed the limit"', async () => {
          await expectRevert(pool.setBonusRate(toDecimalStr('1.000000000000000001')), 'exceed the limit');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(pool.connect(accounts[1]).setBonusRate(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setWithdrawFeeRate', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await pool.setWithdrawFeeRate(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await pool.withdrawFeeRate()), '0');
        });
      });

      context('when set 0.1', () => {
        before(async () => {
          await pool.setWithdrawFeeRate(toDecimalStr(0.1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await pool.withdrawFeeRate()), '0.1');
        });
      });

      context('when set 0.100000000000000001', () => {
        it('should revert with "exceed the limit"', async () => {
          await expectRevert(pool.setWithdrawFeeRate(toDecimalStr('0.100000000000000001')), 'exceed the limit');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(pool.connect(accounts[1]).setWithdrawFeeRate(toDecimalStr(0.1)), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#setFreeWithdrawableRate', () => {
    context('when owner', () => {
      context('when set 0', () => {
        before(async () => {
          await pool.setFreeWithdrawableRate(toDecimalStr(0));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await pool.freeWithdrawableRate()), '0');
        });
      });

      context('when set 1', () => {
        before(async () => {
          await pool.setFreeWithdrawableRate(toDecimalStr(1));
        });

        it('should pass', async () => {
          assert.equal(strFromDecimal(await pool.freeWithdrawableRate()), '1');
        });
      });

      context('when set 1.000000000000000001', () => {
        it('should revert with "exceed the limit"', async () => {
          await expectRevert(pool.setFreeWithdrawableRate(toDecimalStr('1.000000000000000001')), 'exceed the limit');
        });
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(pool.connect(accounts[1]).setFreeWithdrawableRate(toDecimalStr(1)), 'Ownable: caller is not the owner');
      });
    });
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
            await setupDeposit(pool, usdc, accounts[1]);
          });

          it('should get 1000 shares', async () => {
            assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[1].address)), '1000');
            assert.equal(strFromDecimal(await vault.balanceOf(pool.address)), '1000');
            assert.equal(strFromDecimal(await usdc.balanceOf(accounts[1].address), 6), '9000');
          });
        });

        context('when deposit 0', () => {
          it('should revert with "amount is 0"', async () => {
            await expectRevert(pool.connect(accounts[1]).deposit(toDecimalStr(0)), 'amount is 0');
          });
        });

        context('when deposit 0.0000001', () => {
          it('should revert with "amount is 0"', async () => {
            await expectRevert(pool.connect(accounts[1]).deposit(toDecimalStr(0.0000001)), 'amount is 0');
          });
        });

        context('when deposit 0.0000019', () => {
          let pool2, poolToken2;

          before(async () => {
            ({ pool: pool2, poolToken: poolToken2 } = (await createDefaultPool(vault, config)));
            await usdc.mint(accounts[2].address, toDecimalStr(10000, 6));
            await usdc.connect(accounts[2]).approve(pool2.address, toDecimalStr(100000000000, 6));
            await pool2.connect(accounts[2]).deposit(toDecimalStr('0.0000019'));
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
          it('should revert with "amount is 0"', async () => {
            await expectRevert(pool.connect(accounts[1]).deposit(toDecimalStr('0.0000000000000000001')), 'amount is 0');
          });
        });

        context('when deposit 0.0000000000000000019', () => {
          before(async () => {
            await pool.connect(accounts[1]).deposit(toDecimalStr('0.0000000000000000019'));
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
        const { vault, config, pool, poolToken, usdc } = (await setup(decimals));
        await setupDeposit(pool, usdc, accounts[1], decimals);
        await usdc.mint(accounts[2].address, toDecimalStr(10000, decimals));
        await usdc.connect(accounts[2]).approve(pool.address, toDecimalStr(100000000000, decimals));
        return { vault, config, pool, poolToken, usdc };
      };

      context('when decimals 6', () => {
        let vault, config, pool, poolToken, usdc;
        decimals = 6;

        beforeEach(async () => {
          ({ vault, config, pool, poolToken, usdc } = await subSetup(decimals));
        });

        context('when share price 1', () => {
          beforeEach(async () => {
            await pool.connect(accounts[2]).deposit(toDecimalStr(200));
          });

          it('should get 200 shares', async () => {
            assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '200');
            assert.equal(strFromDecimal(await vault.balanceOf(pool.address)), '1200');
            assert.equal(strFromDecimal(await usdc.balanceOf(accounts[2].address), 6), '9800');
          });
        });

        // equity: 1013.942379012956017300
        context('when share price 1.013942379012956017', () => {
          beforeEach(async () => {
            await setupPosition(vault, usdc, decimals);
            await pool.connect(accounts[2]).deposit(toDecimalStr(200));
          });

          // 200 * 1000 / 1013.942379012956017300
          it('should get 197.249867585862517048 shares', async () => {
            assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '197.249867585862517048');
          });
        });

        // initialMargin: 1418.967237296534569490
        // marginBalance: 1141.550297531393538440
        // equity: 792.583060234858968950
        // max bonus part: 277.41693976514103105
        context('when share price 0.792583060234858968', () => {
          beforeEach(async () => {
            await setupPosition(vault, usdc, decimals);
            await spotPricer.setPrice(toDecimalStr(1070));
          });

          context('when zlm', () => {
            beforeEach(async () => {
              await pool.setZlmRate(toDecimalStr('0.740731831995195299'));
            });

            context('when all bonus', () => {
              beforeEach(async () => {
                await pool.connect(accounts[2]).deposit(toDecimalStr(200));
              });

              // (200 * 1.06) * 1000 / 792.583060234858968950
              it('should get 267.479852442443013657 shares', async () => {
                assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '267.479852442443013657');
              });
            });

            context('when partial bonus', () => {
              beforeEach(async () => {
                await pool.connect(accounts[2]).deposit(toDecimalStr(2000));
              });

              // (277.41693976514103105 * 1.06 + (2000 - 277.41693976514103105)) * 1000 / 792.583060234858968950
              it('should get 2544.395808545711645246 shares', async () => {
                assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '2544.395808545711645246');
              });
            });
          });

          context('when not zlm', () => {
            beforeEach(async () => {
              await pool.setZlmRate(toDecimalStr('0.740731831995195298'));
              await pool.connect(accounts[2]).deposit(toDecimalStr(200));
            });

            // 200 * 1000 / 792.583060234858968950
            it('should get 252.339483436266994016 shares', async () => {
              assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '252.339483436266994016');
            });
          });
        });
      });

      context('when decimals 19', () => {
        let vault, pool, poolToken, usdc;
        const decimals = 19;

        before(async () => {
          ({ vault, pool, poolToken, usdc } = await subSetup(decimals));
        });

        context('when share price 1.00966629982777164', () => {
          before(async () => {
            await setupPosition(vault, usdc, decimals);
          });

          context('when deposit 0.000000000000000002', () => {
            before(async () => {
              await pool.connect(accounts[2]).deposit(toDecimalStr('0.000000000000000002'));
            });

            it('should get 0.000000000000000001 shares', async () => {
              assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[2].address)), '0.000000000000000001');
            });
          });

          context('when deposit 0.000000000000000001', () => {
            it('should revert with "shares is 0"', async () => {
              await expectRevert(pool.connect(accounts[2]).deposit(toDecimalStr('0.000000000000000001')), 'shares is 0');
            });
          });
        });
      });
    });

    context('when bankruptcy ', () => {
      let vault, pool, usdc;

      before(async () => {
        ({ vault, pool, usdc } = await setup());
        await setupDeposit(pool, usdc, accounts[1]);
        await setupPosition(vault, usdc);
        await spotPricer.setPrice(toDecimalStr(1200));
      });

      context('when before clear', () => {
        it('should revert with "pool bankruptcy"', async () => {
          await expectRevert(pool.connect(accounts[1]).deposit(toDecimalStr(1000)), 'pool bankruptcy');
        });
      });

      context('when after clear', () => {
        before(async () => {
          await vault.clear(pool.address);
        });

        it('should revert with "pool bankruptcy"', async () => {
          await expectRevert(pool.connect(accounts[1]).deposit(toDecimalStr(1000)), 'pool bankruptcy');
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
          await setupDeposit(pool, usdc, accounts[1]);
          await pool.connect(accounts[1]).withdraw(toDecimalStr(1000), '0');
        });

        it('should get all', async () => {
          assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[1].address)), '0');
          assert.equal(strFromDecimal(await vault.balanceOf(pool.address)), '0');
          assert.equal(strFromDecimal(await usdc.balanceOf(accounts[1].address), 6), '10000');
        });
      });

      context('when withdraw partial', () => {
        before(async () => {
          await setupDeposit(pool, usdc, accounts[2]);
          await pool.connect(accounts[2]).withdraw(toDecimalStr(100), '0');
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
        const { vault, config, pool, poolToken, usdc } = (await setup());
        await setupDeposit(pool, usdc, accounts[1]);
        await setupPosition(vault, usdc);
        const accountInfo = await vault.getAccountInfo(pool.address);
        const sharePrice = toBigNumber(accountInfo.equity).div(1000);
        return { vault, config, pool, poolToken, usdc, sharePrice }
      };

      context('when withdraw under freeWithdrawableRate', () => {
        let vault, config, pool, poolToken, usdc;
        let sharePrice, sharePrice2;

        before(async () => {
          ({ vault, config, pool, poolToken, usdc, sharePrice } = await subSetup());
          await pool.setFreeWithdrawableRate(toDecimalStr(0.99));
          await pool.connect(accounts[1]).withdraw(toDecimalStr(1), '0');
          const accountInfo = await vault.getAccountInfo(pool.address);
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
          it('should revert with "available must be greater than 0"', async () => {
            await expectRevert(pool.connect(accounts[1]).withdraw(toDecimalStr(1), '0'), 'available must be greater than 0');
          });
        });

        context('when other pool available', () => {
          before(async () => {
            let { pool: pool2 } = (await createDefaultPool(vault, config));
            await setupDeposit(pool2, usdc, accounts[3]);
          });

          context('when unacceptable', () => {
            it('should revert with "unacceptable amount"', async () => {
              await expectRevert(pool.connect(accounts[1]).withdraw(toDecimalStr(1), toDecimalStr('1.008649863719596914')), 'unacceptable amount');
            });
          });

          context('when acceptable', () => {
            before(async () => {
              await pool.connect(accounts[1]).withdraw(toDecimalStr(1), toDecimalStr('1.008649863719596913'));
              const accountInfo = await vault.getAccountInfo(pool.address);
              sharePrice2 = toBigNumber(accountInfo.equity).div(999);
            });

            // remove size: 0.00999
            // spot fee: 0.002997
            // option price: 12.827953914221877123
            // utilization: 0% -> 0.0999%
            // option fee: 0.001281579976614
            // total fee: 0.004278579976614
            // before fee: 1.012928436633943
            // after fee: 1.0086498566573290612827
            it('should reduce position', async () => {
              assert.equal(sharePrice2.gte(sharePrice), true);
              assert.equal(strFromDecimal(await vault.positionSizeOf(pool.address, expiry, strike, true)), '-9.99001');
              assert.equal(strFromDecimal(await poolToken.balanceOf(accounts[1].address)), '999');
              assert.equal(strFromDecimal(await usdc.balanceOf(accounts[1].address), 6), '9001.008649');
            });
          });
        });
      });
    });
  });
});
