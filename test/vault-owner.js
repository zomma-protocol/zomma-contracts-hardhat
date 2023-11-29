const { ethers } = require('hardhat');
const assert = require('assert');
const { getContractFactories, expectRevert, expectRevertCustom, toDecimalStr, createOptionPricer, createSignatureValidator, UINT_MAX } = require('./support/helper');

let Vault, Config, TestERC20, SpotPricer, OptionMarket, VaultOwner, accounts;
describe('VaultOwner', () => {
  let stakeholderAccount, insuranceAccount, trader;
  let spotPricer, optionPricer, vault, config, usdc, optionMarket, signatureValidator, vaultOwner, vaultProxy;

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
    await optionMarket.setVault(vault.address);
    await optionPricer.reinitialize(config.address, vault.address);
    const vaultOwner = await VaultOwner.deploy();
    await vaultOwner.initialize(vault.address);
    await vault.changeOwner(vaultOwner.address);
    const vaultProxy = await ethers.getContractAt('TestVault', vaultOwner.address);
    return { vault, config, usdc, optionMarket, vaultOwner, vaultProxy };
  };

  before(async () => {
    [Vault, Config, TestERC20, SpotPricer, OptionMarket, VaultOwner] = await getContractFactories('TestVault', 'Config', 'TestERC20', 'TestSpotPricer', 'TestOptionMarket', 'VaultOwner');
    accounts = await ethers.getSigners();
    [stakeholderAccount, insuranceAccount, trader] = accounts;
    spotPricer = await SpotPricer.deploy();
    optionPricer = await createOptionPricer();
    signatureValidator = await createSignatureValidator();
    ({ vault, config, usdc, optionMarket, vaultOwner, vaultProxy } = await setup());
  });

  describe('#initialize', () => {
    context('when initialize once', () => {
      it('should pass', async () => {
        assert.equal(await vaultOwner.vault(), vault.address);
        assert.equal(await vaultOwner.owner(), stakeholderAccount.address);
        assert.equal(await vaultOwner.hasRole('0x0000000000000000000000000000000000000000000000000000000000000000', stakeholderAccount.address), true);
      });
    });

    context('when initialize twice', () => {
      it('should revert with "Initializable: contract is already initialized"', async () => {
        await expectRevert(vaultOwner.initialize(vault.address), 'Initializable: contract is already initialized');
      });
    });
  });

  describe('#setAddresses', () => {
    context('when vaultOwner', () => {
      before(async () => {
        await vaultProxy.setAddresses(trader.address, spotPricer.address, optionPricer.address, optionMarket.address, signatureValidator.address);
      });

      after(async () => {
        await vaultProxy.setAddresses(config.address, spotPricer.address, optionPricer.address, optionMarket.address, signatureValidator.address);
      });

      it('should pass', async () => {
        assert.equal(await vault.config(), trader.address);
        assert.equal(await vault.spotPricer(), spotPricer.address);
        assert.equal(await vault.optionPricer(), optionPricer.address);
      });
    });

    context('when not vaultOwner', () => {
      it('should revert with NotOwner', async () => {
        await expectRevertCustom(vault.setAddresses(trader.address, spotPricer.address, optionPricer.address, optionMarket.address, signatureValidator.address), Vault, 'NotOwner');
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(vaultProxy.connect(trader).setAddresses(trader.address, spotPricer.address, optionPricer.address, optionMarket.address, signatureValidator.address), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#changeOwner', () => {
    context('when vaultOwner', () => {
      before(async () => {
        await vaultProxy.changeOwner(trader.address);
      });

      after(async () => {
        await vault.connect(trader).changeOwner(stakeholderAccount.address);
      });

      it('should pass', async () => {
        assert.equal(await vault.owner(), trader.address);
      });
    });

    context('when not vaultOwner', () => {
      it('should revert with NotOwner', async () => {
        await expectRevertCustom(vault.connect(trader).changeOwner(trader.address), Vault, 'NotOwner');
      });
    });
  });

  describe('#approveVault', () => {
    context('when owner', () => {
      let usdc2;

      before(async () => {
        usdc2 = await TestERC20.deploy('USDC', 'USDC', 18);
        await config.setQuote(usdc2.address, 18);
        await vaultOwner.approveVault();
      });

      after(async () => {
        await config.setQuote(usdc.address, 6);
      });

      it('should approved', async () => {
        assert.equal(await usdc2.allowance(vaultOwner.address, vault.address), UINT_MAX);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(vaultOwner.connect(trader).approveVault(), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#withdraw', () => {
    context('when owner', () => {
      let balance, balanceAfter;

      before(async () => {
        await vaultOwner.withdrawToken(usdc.address, {
          value: toDecimalStr(1)
        });
        balance = await stakeholderAccount.getBalance();
        await vaultOwner.withdraw();
        balanceAfter = await stakeholderAccount.getBalance();
      });

      it('should pass', async () => {
        assert.equal(balanceAfter.gt(balance), true);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(vaultOwner.connect(trader).withdraw(), 'Ownable: caller is not the owner');
      });
    });
  });

  describe('#withdrawToken', () => {
    context('when owner', () => {
      let balance, balanceAfter;

      before(async () => {
        await usdc.mint(vaultOwner.address, toDecimalStr(1, 6));
        balance = await usdc.balanceOf(stakeholderAccount.address);
        await vaultOwner.withdrawToken(usdc.address);
        balanceAfter = await usdc.balanceOf(stakeholderAccount.address);
      });

      it('should pass', async () => {
        assert.equal(balanceAfter.gt(balance), true);
      });
    });

    context('when not owner', () => {
      it('should revert with "Ownable: caller is not the owner"', async () => {
        await expectRevert(vaultOwner.connect(trader).withdrawToken(usdc.address), 'Ownable: caller is not the owner');
      });
    });
  });
});
