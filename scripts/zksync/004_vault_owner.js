require('dotenv').config();

const {
  getOrDeployProxy,
  getEnvs,
  getContractAt
} = require('./helper');
const { logProxy } = require('../helper');

const {
  vaultContract
} = getEnvs();

// An example of a deploy script that will deploy and call a simple contract.
async function main () {
  if (!process.env.TRADER) {
    throw new Error('Trader not set');
  }
  const vault = await getContractAt(process.env.VAULT, vaultContract);
  const vaultOwner = await getOrDeployProxy(process.env.VAULT_OWNER, {
    contract: 'VaultOwner',
    deployed: async(c) => {
      console.log('initialize...');
      await (await c.initialize(vault.address)).wait();

      console.log('grantRole...');
      await c.grantRole('0x872340a532bdd7bb02bea115c1b0f1ba87eac982f5b79b51ac189ffaac1b6fce', process.env.TRADER);
    }
  });
  if ((await vault.owner()).toLowerCase() !== vaultOwner.address.toLowerCase()) {
    console.log('changeOwner...');
    await vault.changeOwner(vaultOwner.address);
  }

  console.log('=== contract ===');
  console.log(`VAULT_OWNER=${vaultOwner.address}`);

  await logProxy('VAULT_OWNER', vaultOwner);

  console.log('=== develop ===');
  console.log(`process.env.VAULT_OWNER='${vaultOwner.address.toLowerCase()}'`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
