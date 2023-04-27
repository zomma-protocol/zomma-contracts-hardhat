const assert = require('assert');
const { getContractFactories, expectRevert, toDecimalStr, strFromDecimal, createOptionPricer, buildIv, mergeIv, addPool, mintAndDeposit, INT_MAX } = require('./support/helper');

let VaultPricer, Vault, Config, TestERC20, SpotPricer, OptionMarket, accounts;
describe('VaultPricer', () => {
  let stakeholderAccount, insuranceAccount, trader, trader2, pool, settler, liquidator, otherAccount, otherAccount2, pool2;
  const now = 1673596800; // 2023-01-13T08:00:00Z
  const expiry = 1674201600; // 2023-01-20T08:00:00Z
  const strike = toDecimalStr(1100);
  let vaultPricer, spotPricer, optionPricer, vault, config, usdc, optionMarket;

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
    const vaultPricer = await VaultPricer.deploy();
    await config.initialize(vault.address, stakeholderAccount.address, insuranceAccount.address, usdc.address, decimals);
    await optionMarket.setVault(vault.address);
    await optionPricer.reinitialize(config.address, vault.address);
    await vaultPricer.initialize(vault.address, config.address, spotPricer.address, optionPricer.address, optionMarket.address);
    return { vaultPricer, vault, config, usdc, optionMarket };
  };

  const setupMarket = async (vault, optionMarket, ivs = [[expiry, strike, true, true, toDecimalStr(0.8), false], [expiry, strike, true, false, toDecimalStr(0.8), false]]) => {
    await vault.setTimestamp(now);
    await spotPricer.setPrice(toDecimalStr(1000));
    await optionMarket.setIv(mergeIv(ivs.map((iv) => buildIv(...iv))));
    await optionPricer.updateLookup(ivs.map((iv) => iv[0]));
  };

  before(async () => {
    [VaultPricer, Vault, Config, TestERC20, SpotPricer, OptionMarket] = await getContractFactories('TestVaultPricer', 'TestVault', 'Config', 'TestERC20', 'TestSpotPricer', 'TestOptionMarket');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader, trader2, pool, settler, liquidator, otherAccount, otherAccount2, pool2] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer();
    ({ vaultPricer, vault, config, usdc, optionMarket } = await setup());
  });

  describe('#initialize', () => {
    context('when owner', () => {
      before(async () => {
        await vaultPricer.initialize(vault.address, config.address, spotPricer.address, optionPricer.address, optionMarket.address);
      });

      it('should pass"', async () => {
        assert.equal(await vaultPricer.vault(), vault.address);
        assert.equal(await vaultPricer.config(), config.address);
        assert.equal(await vaultPricer.spotPricer(), spotPricer.address);
        assert.equal(await vaultPricer.optionPricer(), optionPricer.address);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(vaultPricer.connect(trader).initialize(vault.address, config.address, spotPricer.address, optionPricer.address, optionMarket.address), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#getPremium', () => {
    before(async () => {
      await config.setPoolProportion(toDecimalStr(1));
      await setupMarket(vault, optionMarket);
      await addPool(config, pool);
      await mintAndDeposit(vault, usdc, pool);
      await mintAndDeposit(vault, usdc, trader);
    });

    context('when expired', () => {
      before(async () => {
        await vault.setTimestamp(expiry);
      });

      after(async () => {
        await vault.setTimestamp(now);
      });

      context('when price settled', () => {
        context('when settled price 1101', () => {
          let premium, fee;

          before(async () => {
            await spotPricer.setSettledPrice(expiry, toDecimalStr(1101));
            [premium, fee] = await vaultPricer.getPremium(expiry, strike, true, toDecimalStr(1));
            await spotPricer.setSettledPrice(expiry, toDecimalStr(0));
          });

          it('should be premium -1', async () => {
            assert.equal(strFromDecimal(premium), '-1');
          });

          it('should be fee -0.1', async () => {
            assert.equal(strFromDecimal(fee), '-0.1');
          });
        });

        context('when settled price 1100', () => {
          let premium, fee;

          before(async () => {
            await spotPricer.setSettledPrice(expiry, toDecimalStr(1100));
            [premium, fee] = await vaultPricer.getPremium(expiry, strike, true, toDecimalStr(1));
            await spotPricer.setSettledPrice(expiry, toDecimalStr(0));
          });

          it('should be premium 0', async () => {
            assert.equal(strFromDecimal(premium), '0');
          });

          it('should be fee 0', async () => {
            assert.equal(strFromDecimal(fee), '0');
          });
        });
      });

      context('when price not settled', () => {
        context('when spot 1101', () => {
          let premium, fee;

          before(async () => {
            await spotPricer.setPrice(toDecimalStr(1101));
            [premium, fee] = await vaultPricer.getPremium(expiry, strike, true, toDecimalStr(1));
            await spotPricer.setPrice(toDecimalStr(1000));
          });

          it('should be premium -1', async () => {
            assert.equal(strFromDecimal(premium), '-1');
          });

          it('should be fee -0.1', async () => {
            assert.equal(strFromDecimal(fee), '-0.1');
          });
        });

        context('when spot 1100', () => {
          let premium, fee;

          before(async () => {
            await spotPricer.setPrice(toDecimalStr(1100));
            [premium, fee] = await vaultPricer.getPremium(expiry, strike, true, toDecimalStr(1));
            await spotPricer.setPrice(toDecimalStr(1000));
          });

          it('should be premium 0', async () => {
            assert.equal(strFromDecimal(premium), '0');
          });

          it('should be fee 0', async () => {
            assert.equal(strFromDecimal(fee), '0');
          });
        });
      });
    });

    context('when not expired', () => {
      context('when no position can close', () => {
        let premium, fee;

        before(async () => {
          [premium, fee] = await vaultPricer.getPremium(expiry, strike, true, toDecimalStr(1));
        });

        it('should be premium -12.827953914221877123', async () => {
          assert.equal(strFromDecimal(premium), '-12.827953914221877123');
        });

        it('should be fee -0.428279539142218771', async () => {
          assert.equal(strFromDecimal(fee), '-0.428279539142218771');
        });
      });

      context('when position can close', () => {
        before(async () => {
          await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-1), 0);
        });

        context('when partial close', () => {
          let premium, fee;

          before(async () => {
            [premium, fee] = await vaultPricer.getPremium(expiry, strike, true, toDecimalStr(2));
          });

          // new open part
          // -12.827895956752105513
          // -0.428278959567521055

          it('should be premium -25.588687808595857627', async () => {
            assert.equal(strFromDecimal(premium), '-25.588687808595857627');
          });

          it('should be fee -0.855886878085958576', async () => {
            assert.equal(strFromDecimal(fee), '-0.855886878085958576');
          });
        });

        context('when all close', () => {
          let premium, fee;

          before(async () => {
            [premium, fee] = await vaultPricer.getPremium(expiry, strike, true, toDecimalStr(1));
          });

          it('should be premium -12.760791851843752114', async () => {
            assert.equal(strFromDecimal(premium), '-12.760791851843752114');
          });

          it('should be fee -0.427607918518437521', async () => {
            assert.equal(strFromDecimal(fee), '-0.427607918518437521');
          });
        });

        context('when close and open, multi-pools', () => {
          let premium, fee;

          before(async () => {
            await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(1), INT_MAX);
            await addPool(config, pool2);
            await mintAndDeposit(vault, usdc, pool2);
            await vault.connect(trader).trade(expiry, strike, true, toDecimalStr(-1), 0);
            [premium, fee] = await vaultPricer.getPremium(expiry, strike, true, toDecimalStr(2));
          });

          // close: -12.760791851843752114
          // open:  -12.794343975365589297
          it('should be premium -25.555135827209341411', async () => {
            assert.equal(strFromDecimal(premium), '-25.555135827209341411');
          });

          // close: -0.427607918518437521
          // open: -0.427943439753655892
          it('should be fee -0.855551358272093413', async () => {
            assert.equal(strFromDecimal(fee), '-0.855551358272093413');
          });
        });
      });
    });
  });
});
