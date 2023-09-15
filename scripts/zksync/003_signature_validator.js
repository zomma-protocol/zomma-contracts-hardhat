require('dotenv').config();

const {
  getOrDeployProxy,
  getEnvs,
  upgradeProxy
} = require('./helper');
const { logProxy } = require('../helper');

const {
  spotPricerContract,
  optionPricerContract,
  optionMarketContract,
  vaultContract
} = getEnvs();

// An example of a deploy script that will deploy and call a simple contract.
async function main () {
  const spotPricer = await upgradeProxy(process.env.SPOT_PRICER, spotPricerContract);
  const optionPricer = await upgradeProxy(process.env.OPTION_PRICER, optionPricerContract);
  const optionMarket = await upgradeProxy(process.env.OPTION_MARKET, optionMarketContract);
  const config = await upgradeProxy(process.env.CONFIG, 'Config');
  const vault = await upgradeProxy(process.env.VAULT, vaultContract);
  const signatureValidator = await getOrDeployProxy(process.env.SIGNATURE_VALIDATOR, {
    contract: 'SignatureValidator',
    deployed: async(c) => {
      await c.initialize();
    }
  });

  if ((await vault.signatureValidator()).toLowerCase() !== signatureValidator.address.toLowerCase()) {
    await vault.setAddresses(config.address, spotPricer.address, optionPricer.address, optionMarket.address, signatureValidator.address);
  }

  console.log('=== api ===');
  console.log(`SIGNATURE_VALIDATOR=${signatureValidator.address.toLowerCase()}`);

  console.log('=== fe ===');
  console.log(`signatureValidator: '${signatureValidator.address.toLowerCase()}'`);

  console.log('=== contract ===');
  console.log(`SIGNATURE_VALIDATOR=${signatureValidator.address}`);

  await logProxy('VAULT', vault);
  await logProxy('CONFIG', config);
  await logProxy('SPOT_PRICER', spotPricer);
  await logProxy('OPTION_PRICER', optionPricer);
  await logProxy('OPTION_MARKET', optionMarket);
  await logProxy('SIGNATURE_VALIDATOR', signatureValidator);

  console.log('=== develop ===');
  console.log(`process.env.SIGNATURE_VALIDATOR='${signatureValidator.address.toLowerCase()}'`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
