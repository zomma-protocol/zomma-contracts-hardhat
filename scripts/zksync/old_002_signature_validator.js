require('dotenv').config();

const {
  getOrDeployProxy,
  getEnvs,
  upgradeProxy
} = require('./helper');
const { logProxy, toDecimalStr } = require('../helper');

const {
  spotPricerContract,
  optionPricerContract,
  optionMarketContract,
  vaultContract
} = getEnvs();

// An example of a deploy script that will deploy and call a simple contract.
async function main () {
  const spotPricer = await upgradeProxy(process.env.SPOT_PRICER, spotPricerContract);
  if (spotPricerContract === 'SignedSpotPricer') {
    console.log('setValidPeriod...');
    await spotPricer.setValidPeriod(3600);

    console.log('setMaxPrice...');
    await spotPricer.setMaxPrice(toDecimalStr(10000000));

    console.log('setMinPrice...');
    await spotPricer.setMinPrice(toDecimalStr(0.001));
  }

  const optionPricer = await upgradeProxy(process.env.OPTION_PRICER, optionPricerContract);
  const optionMarket = await upgradeProxy(process.env.OPTION_MARKET, optionMarketContract);
  const config = await upgradeProxy(process.env.CONFIG, 'Config');
  const vault = await upgradeProxy(process.env.VAULT, vaultContract);
  const rewardDistributor = await upgradeProxy(process.env.REWARD_DISTRIBUTOR, 'RewardDistributor');
  const signatureValidator = await getOrDeployProxy(process.env.SIGNATURE_VALIDATOR, {
    contract: 'SignatureValidator',
    deployed: async(c) => {
      await c.initialize();

      console.log('grant user role...');
      await c.grantRole('0x2db9fd3d099848027c2383d0a083396f6c41510d7acfd92adc99b6cffcf31e96', vault.address);
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
  await logProxy('REWARD_DISTRIBUTOR', rewardDistributor);
  await logProxy('SIGNATURE_VALIDATOR', signatureValidator);

  console.log('=== develop ===');
  console.log(`process.env.SIGNATURE_VALIDATOR='${signatureValidator.address.toLowerCase()}'`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
