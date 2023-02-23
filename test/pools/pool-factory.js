const assert = require('assert');
const { getContractFactories } = require('../support/helper');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');

let PoolFactory, Pool, PoolToken, Config, Vault, TestERC20, accounts;
describe('PoolFactory', () => {
  let poolFactory, pool, poolToken, vault;

  before(async () => {
    [PoolFactory, Pool, PoolToken, Config, Vault, TestERC20] = await getContractFactories('PoolFactory', 'Pool', 'PoolToken', 'Config', 'TestVault', 'TestERC20');
    accounts = await ethers.getSigners();
    const quote = await TestERC20.deploy('USDC', 'USDC', 6);
    const config = await Config.deploy();
    vault = await Vault.deploy();
    await config.initialize(vault.address, ZERO_ADDRESS, ZERO_ADDRESS, quote.address, 6);
    await vault.initialize(config.address, ZERO_ADDRESS, ZERO_ADDRESS);

    poolFactory = await PoolFactory.deploy();
    const result = await (await poolFactory.create(vault.address, 'NAME', 'SYMBOL')).wait();
    const create = result.events.find((e) => e.event === 'Create').args;
    pool = await ethers.getContractAt('Pool', create.pool);
    poolToken = await ethers.getContractAt('PoolToken', create.poolToken);
  });

  describe('#create', () => {
    it('should pass', async () => {
      assert.equal(await poolToken.initialized(), true);
      assert.equal(await poolToken.name(), 'NAME');
      assert.equal(await poolToken.symbol(), 'SYMBOL');
      assert.equal(await pool.initialized(), true);
      assert.equal(await pool.owner(), accounts[0].address);
      assert.equal(await pool.vault(), vault.address);
      assert.equal(await pool.token(), poolToken.address);
    });
  });
});