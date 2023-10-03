const hre = require('hardhat');
const { Wallet, ContractFactory } = require("zksync-web3");
const { Deployer } = require("@matterlabs/hardhat-zksync-deploy");

function getWallet() {
  // Get private key from the environment variable
  const PRIVATE_KEY = process.env.PK || "";
  if (!PRIVATE_KEY) {
    throw new Error("Please set ZKS_PRIVATE_KEY in the environment variables.");
  }

  return new Wallet(PRIVATE_KEY);
}

const wallet = getWallet();
const deployer = new Deployer(hre, wallet);

async function upgradeProxy(address, contract) {
  const artifact = await deployer.loadArtifact(contract);
  console.log(`upgrade ${contract}...`);
  return await deployer.hre.zkUpgrades.upgradeProxy(deployer.zkWallet, address, artifact);
}

async function getContractAt(address, nameOrAbi) {
  const artifact = await deployer.hre.artifacts.readArtifact(nameOrAbi);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer.zkWallet, deployer.deploymentType);
  return factory.attach(address);
}

async function deploy({ contract, deployed, args = [] }) {
  const artifact = await deployer.loadArtifact(contract);
  console.log(`deploy ${contract}...`);
  const instance = await deployer.deploy(artifact, args);
  console.log(instance.address);
  if (deployed) {
    await deployed(instance);
  }
  return instance;
}

async function getOrDeploy(address, { contract, deployed, args = [] }) {
  if (address) {
    return await getContractAt(address, contract);
  } else {
    return await deploy({ contract, deployed, args });
  }
}

async function deployProxy({ contract, deployed, args = [] }) {
  const artifact = await deployer.loadArtifact(contract);
  console.log(`deploy ${contract} Proxy...`);
  const instance = await deployer.hre.zkUpgrades.deployProxy(deployer.zkWallet, artifact, [], { initializer: false });
  await instance.deployed();
  console.log(instance.address);
  console.log(`${contract} Admin`, (await upgrades.erc1967.getAdminAddress(instance.address)));
  console.log(`${contract} Implementation`, (await upgrades.erc1967.getImplementationAddress(instance.address)));
  if (deployed) {
    await deployed(instance);
  }
  return instance;
}

async function getOrDeployProxy(address, { contract, deployed, args = [] }) {
  if (address) {
    return await getContractAt(address, contract);
  } else {
    return await deployProxy({ contract, deployed, args });
  }
}

function getEnvs() {
  const isProduction = process.env.PRODUCTION === '1';
  const optionPricerType = process.env.OPTION_PRICER_TYPE || 'normal';
  const vaultType = process.env.VAULT_TYPE || 'normal';
  let oracle = process.env.ORACLE || 'chainlink-interim';

  let spotPricerContract, optionPricerContract, optionMarketContract, vaultContract, chainlinkContract, chainlinkProxyContract, poolContract;
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

  // signed, normal
  switch (vaultType) {
    case 'signed':
      vaultContract = isProduction ? 'SignedVault' : 'TestSignedVault';
      poolContract = 'SignedPool';
      oracle = 'zomma';
      break;
    default: // normal
      vaultContract = isProduction ? 'Vault' : 'TestVault';
      poolContract = 'Pool';
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
    chainlinkDeployable,
    isChainlinkSystem,
    poolContract
  }
}

module.exports = {
  upgradeProxy,
  getContractAt,
  deploy,
  getOrDeploy,
  deployProxy,
  getOrDeployProxy,
  getEnvs,
  getWallet
}
