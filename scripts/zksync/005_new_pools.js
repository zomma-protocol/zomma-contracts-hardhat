require('dotenv').config();

const {
  getOrDeployProxy,
  getEnvs,
  getContractAt
} = require('./helper');
const { toDecimalStr, logProxy } = require('../helper');

const {
  vaultContract,
  poolContract
} = getEnvs();

async function createPool(vault, config, index, reservedRate, poolAddress, poolTokenAddress, poolOwnerAddress) {
  console.log(`create pool ${index}...`);
  const pool = await getOrDeployProxy(poolAddress, {
    contract: poolContract
  });
  const poolToken = await getOrDeployProxy(poolTokenAddress, { contract: 'PoolToken' });
  if (!poolAddress) {
    console.log('poolToken.initialize...');
    await poolToken.initialize(pool.address, `Pool ${index} Share`, `P${index}-SHARE`);
    console.log('pool.initialize...');
    await (await pool.initialize(vault.address, poolToken.address)).wait();
    console.log('addPool...')
    await config.addPool(pool.address);
    console.log('setReservedRate...');
    await pool.setReservedRate(reservedRate);
  }

  const poolOwner = await getOrDeployProxy(poolOwnerAddress, {
    contract: 'PoolOwner',
    deployed: async(c) => {
      console.log('initialize...');
      await (await c.initialize(pool.address)).wait();

      console.log('grantRole...');
      await c.grantRole('0x7a8dc26796a1e50e6e190b70259f58f6a4edd5b22280ceecc82b687b8e982869', process.env.SIGNATURE_SENDER);

      console.log('transferOwnership...');
      await pool.transferOwnership(c.address);
    }
  });
  return { pool, poolToken, poolOwner };
}

// An example of a deploy script that will deploy and call a simple contract.
async function main () {
  if (!process.env.SIGNATURE_SENDER) {
    throw new Error('Signature sender not set');
  }
  const vault = await getContractAt(process.env.VAULT, vaultContract);
  const config = await getContractAt(process.env.CONFIG, 'Config');

  const { pool, poolToken, poolOwner } = await createPool(vault, config, 2, toDecimalStr(0.3), process.env.POOL_1, process.env.POOL_TOKEN_1, process.env.POOL_OWNER_1);
  const { pool: pool2, poolToken: poolToken2, poolOwner: poolOwner2 } = await createPool(vault, config, 3, toDecimalStr(0.2), process.env.POOL_2, process.env.POOL_TOKEN_2, process.env.POOL_OWNER_2);

  console.log('=== contract ===');
  console.log(`POOL_1=${pool.address}`);
  console.log(`POOL_TOKEN_1=${poolToken.address}`);
  console.log(`POOL_OWNER_1=${poolOwner.address}`);
  console.log(`POOL_2=${pool2.address}`);
  console.log(`POOL_TOKEN_2=${poolToken2.address}`);
  console.log(`POOL_OWNER_2=${poolOwner2.address}`);

  await logProxy('POOL_1', pool);
  await logProxy('POOL_TOKEN_1', poolToken);
  await logProxy('POOL_OWNER_1', poolOwner);
  await logProxy('POOL_2', pool2);
  await logProxy('POOL_TOKEN_2', poolToken2);
  await logProxy('POOL_OWNER_2', poolOwner2);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
