require('dotenv').config();

const { upgrades } = require('hardhat');
const {
  getEnvs,
  getContractAt
} = require('./helper');
const { logProxy } = require('../helper');

const {
  spotPricerContract,
  optionPricerContract,
  optionMarketContract,
  vaultContract
} = getEnvs();

async function changeProxyAdmin(proxy, newAdmin) {
  const adminAddress = await upgrades.erc1967.getAdminAddress(proxy.address);
  if (adminAddress === newAdmin) {
    console.log('same admin, skip');
    return;
  }
  console.log(`Change admin ${adminAddress} to ${newAdmin}`);

  const admin = await getContractAt(adminAddress, 'ProxyAdmin');
  await (await admin.changeProxyAdmin(proxy.address, newAdmin)).wait();
}

// An example of a deploy script that will deploy and call a simple contract.
async function main () {
  const vault = await getContractAt(process.env.VAULT, vaultContract);
  const spotPricer = await getContractAt(process.env.SPOT_PRICER, spotPricerContract);
  const optionPricer = await getContractAt(process.env.OPTION_PRICER, optionPricerContract);
  const optionMarket = await getContractAt(process.env.OPTION_MARKET, optionMarketContract);
  const config = await getContractAt(process.env.CONFIG, 'Config');
  const rewardDistributor = await getContractAt(process.env.REWARD_DISTRIBUTOR, 'RewardDistributor');

  const vaultAdmin = await upgrades.erc1967.getAdminAddress(vault.address);
  console.log('VAULT admin:', vaultAdmin)

  await changeProxyAdmin(spotPricer, vaultAdmin);
  await changeProxyAdmin(optionPricer, vaultAdmin);
  await changeProxyAdmin(optionMarket, vaultAdmin);
  await changeProxyAdmin(config, vaultAdmin);
  await changeProxyAdmin(rewardDistributor, vaultAdmin);

  await logProxy('VAULT', vault);
  await logProxy('CONFIG', config);
  await logProxy('SPOT_PRICER', spotPricer);
  await logProxy('OPTION_PRICER', optionPricer);
  await logProxy('REWARD_DISTRIBUTOR', rewardDistributor);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
