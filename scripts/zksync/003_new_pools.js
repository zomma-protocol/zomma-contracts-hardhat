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

async function createPool(vault, config, signatureValidator, index, reservedRate, poolAddress, poolTokenAddress, poolOwnerAddress) {
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
    console.log('grant user role...');
    await signatureValidator.grantRole('0x2db9fd3d099848027c2383d0a083396f6c41510d7acfd92adc99b6cffcf31e96', pool.address);
  }

  const poolOwner = await getOrDeployProxy(poolOwnerAddress, {
    contract: 'PoolOwner',
    deployed: async(c) => {
      console.log('initialize...');
      await (await c.initialize(pool.address)).wait();

      console.log('grantRole trader...');
      await c.grantRole('0x7a8dc26796a1e50e6e190b70259f58f6a4edd5b22280ceecc82b687b8e982869', process.env.SIGNATURE_SENDER);

      console.log('grantRole liquidator...');
      await c.grantRole('0xeb33521169e672634fcae38dcc3bab0be8a080072000cfbdc0e041665d727c18', process.env.LIQUIDATOR_CONTRACT);

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
  if (!process.env.LIQUIDATOR_CONTRACT) {
    throw new Error('Liquidator contract not set');
  }
  const vault = await getContractAt(process.env.VAULT, vaultContract);
  const config = await getContractAt(process.env.CONFIG, 'Config');
  const signatureValidator = await getContractAt(process.env.SIGNATURE_VALIDATOR, 'SignatureValidator');

  const { pool, poolToken, poolOwner } = await createPool(vault, config, signatureValidator, 0, toDecimalStr(0.3), process.env.POOL_1, process.env.POOL_TOKEN_1, process.env.POOL_OWNER_1);
  const { pool: pool2, poolToken: poolToken2, poolOwner: poolOwner2 } = await createPool(vault, config, signatureValidator, 1, toDecimalStr(0.2), process.env.POOL_2, process.env.POOL_TOKEN_2, process.env.POOL_OWNER_2);

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
