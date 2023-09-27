const { ethers, upgrades } = require('hardhat');
const { buildIv, toDecimalStr, strFromDecimal, mergeIv } = require('../test/support/helper');

function nextFriday(date = new Date()) {
  let expiry = Math.floor(date.getTime() / 1000);
  expiry = expiry - expiry % 86400;
  const day = new Date(expiry * 1000).getDay();
  return expiry + (day >= 5 ? 12 - day : 5 - day) * 86400 + 3600 * 8;
}

async function upgradeProxy(address, contract) {
  const Contract = await ethers.getContractFactory(contract);
  console.log(`upgrade ${contract}...`);
  return await upgrades.upgradeProxy(address, Contract);
}

async function deploy({ contract, deployed, args = [] }) {
  const Contract = await ethers.getContractFactory(contract);
  console.log(`deploy ${contract}...`);
  const instance = await Contract.deploy(...args);
  await instance.deployed();
  console.log(instance.address.toLocaleLowerCase());
  if (deployed) {
    await deployed(instance);
  }
  return instance;
}

async function getOrDeploy(address, { contract, deployed, args = [] }) {
  if (address) {
    return await ethers.getContractAt(contract, address);
  } else {
    return await deploy({ contract, deployed, args });
  }
}

async function deployProxy({ contract, deployed, args = [] }) {
  const Contract = await ethers.getContractFactory(contract);
  console.log(`deploy ${contract} Proxy...`);
  const instance = await upgrades.deployProxy(Contract, [], { initializer: false } );
  await instance.deployed();
  console.log(instance.address.toLocaleLowerCase());
  console.log(`${contract} Admin`, (await upgrades.erc1967.getAdminAddress(instance.address)));
  console.log(`${contract} Implementation`, (await upgrades.erc1967.getImplementationAddress(instance.address)));
  if (deployed) {
    await deployed(instance);
  }
  return instance;
}

async function getOrDeployProxy(address, { contract, deployed, args = [] }) {
  if (address) {
    return await ethers.getContractAt(contract, address);
  } else {
    return await deployProxy({ contract, deployed, args });
  }
}

async function logProxy(label, proxy) {
  console.log(`# ${label} Admin`, (await upgrades.erc1967.getAdminAddress(proxy.address)));
  console.log(`# ${label} Implementation`, (await upgrades.erc1967.getImplementationAddress(proxy.address)));
}

function getEnvs() {
  const isProduction = process.env.PRODUCTION === '1';
  const optionPricerType = process.env.OPTION_PRICER_TYPE || 'normal';
  const vaultType = process.env.VAULT_TYPE || 'normal';
  let oracle = process.env.ORACLE || 'chainlink';

  let spotPricerContract, optionPricerContract, optionMarketContract, vaultContract, chainlinkContract, chainlinkProxyContract;
  if (isProduction) {
    optionMarketContract = 'OptionMarket';
  } else {
    optionMarketContract = 'TestOptionMarket';
  }

  // signed, normal, lookup
  switch (optionPricerType) {
    case 'signed':
      optionPricerContract = 'SignedOptionPricer';
      break;
    case 'lookup':
      optionPricerContract = isProduction ? 'CacheOptionPricer' : 'TestCacheOptionPricer';
      break;
    default: // normal
      optionPricerContract = 'OptionPricer';
      break;
  }

  let setIvs = false;
  // signed, normal
  switch (vaultType) {
    case 'signed':
      vaultContract = isProduction ? 'SignedVault' : 'TestSignedVault';
      poolContract = 'SignedPool';
      setIvs = false;
      oracle = 'zomma';
      break;
    default: // normal
      vaultContract = isProduction ? 'Vault' : 'TestVault';
      poolContract = 'Pool';
      setIvs = true;
      break;
  }

  let chainlinkDeployable = false, isChainlinkSystem = true;
  // chainlink, chainlink-interim, chainlink-dummy
  switch (oracle) {
    case 'chainlink-interim':
      spotPricerContract = isProduction ? 'InterimSpotPricer' : 'TestInterimSpotPricer';
      chainlinkContract = 'InterimChainlink';
      chainlinkProxyContract = 'InterimChainlinkProxy';
      chainlinkDeployable = true;
      break;
    case 'chainlink-dummy':
      spotPricerContract = isProduction ? 'SpotPricer' : 'TestSpotPricer';
      chainlinkContract = 'TestChainlink';
      chainlinkProxyContract = 'TestChainlinkProxy';
      chainlinkDeployable = true;
      break;
    case 'pyth':
      spotPricerContract = isProduction ? 'PythSpotPricer' : 'TestPythSpotPricer';
      vaultContract = isProduction ? 'PythVault' : 'TestPythVault';
      isChainlinkSystem = false;
      break;
    case 'zomma':
      spotPricerContract = 'SignedSpotPricer';
      isChainlinkSystem = false;
      chainlinkDeployable = false;
      break;
    default: // chainlink
      spotPricerContract = isProduction ? 'SpotPricer' : 'TestSpotPricer';
      break;
  }

  return {
    isProduction,
    optionPricerType,
    vaultType,
    oracle,
    spotPricerContract,
    optionPricerContract,
    optionMarketContract,
    vaultContract,
    chainlinkContract,
    chainlinkProxyContract,
    poolContract,
    setIvs,
    chainlinkDeployable,
    isChainlinkSystem
  };
}

module.exports = {
  buildIv,
  nextFriday,
  toDecimalStr,
  strFromDecimal,
  mergeIv,
  upgradeProxy,
  deploy,
  getOrDeploy,
  deployProxy,
  getOrDeployProxy,
  logProxy,
  getEnvs
};
