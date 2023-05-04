require('dotenv').config();

const { Wallet, ContractFactory } = require("zksync-web3");
// const zk = require("zksync-web3");
// const { HardhatRuntimeEnvironment } = require("hardhat/types");
const { Deployer } = require("@matterlabs/hardhat-zksync-deploy");
// const ethers = require("ethers");
const { ethers } = require('hardhat');
const { toDecimalStr } = require('../scripts/helper');
const ln = require('../scripts/ln');
const cdf = require('../scripts/cdf');

// Get private key from the environment variable
const PRIVATE_KEY = process.env.PK || "";
if (!PRIVATE_KEY) {
  throw new Error("Please set ZKS_PRIVATE_KEY in the environment variables.");
}

const isProduction = process.env.PRODUCTION === '1';
const oracle = process.env.ORACLE || 'chainlink-interim';

let spotPricerContract, settlerContract, optionPricerContract, optionMarketContract, vaultContract, chainlinkContract, chainlinkProxyContract;
if (isProduction) {
  settlerContract = 'Settler';
  optionPricerContract = 'CacheOptionPricer';
  optionMarketContract = 'OptionMarket';
  vaultContract = 'Vault';
} else {
  settlerContract = 'TestSettler';
  optionPricerContract = 'TestCacheOptionPricer';
  optionMarketContract = 'TestOptionMarket';
  vaultContract = 'TestVault';
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
  default: // chainlink
    spotPricerContract = isProduction ? 'SpotPricer' : 'TestSpotPricer';
    break;
}

const wallet = new Wallet(PRIVATE_KEY);
let deployer;

async function getContractAt(nameOrAbi, address) {
  const artifact = await deployer.hre.artifacts.readArtifact(nameOrAbi);
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, deployer.zkWallet, deployer.deploymentType);
  return factory.attach(address);
}

async function deploy({ contract, deployed, args = [] }) {
  const artifact = await deployer.loadArtifact(contract);
  console.log(`deploy ${contract}...`);
  const instance = await deployer.deploy(artifact, args);
  console.log(instance.address.toLocaleLowerCase());
  if (deployed) {
    await deployed(instance);
  }
  return instance;
}

async function getOrDeploy(address, { contract, deployed, args = [] }) {
  if (address) {
    return await getContractAt(contract, address);
  } else {
    return await deploy({ contract, deployed, args });
  }
}

// async function createPools(vault, config, poolFactory) {
async function createPools(vault, config) {
  const reservedRates = [
    toDecimalStr(0.3),
    toDecimalStr(0.2),
    toDecimalStr(0.1),
    toDecimalStr(0)
  ];
  const pools = [];
  const addedPools = await config.getPools();
  for (let i = addedPools.length; i < 4; ++i) {
    console.log(`create pool ${i}...`);

    const poolToken = await deploy({
      contract: 'PoolToken'
    });;

    const pool = await deploy({
      contract: 'Pool'
    });

    console.log('poolToken.initialize...');
    await poolToken.initialize(pool.address, `Pool ${i} Share`, `P${i}-SHARE`);
    console.log('pool.initialize...');
    await (await pool.initialize(vault.address, poolToken.address, process.env.DEPLOYER)).wait();
    // await pool.initialize(vault.address, poolToken.address, process.env.DEPLOYER);
    console.log('addPool...')
    await config.addPool(pool.address);
    const reservedRate = reservedRates[i] || reservedRates[0];
    console.log('setReservedRate...')
    await pool.setReservedRate(reservedRate);
    pools.push(pool.address);
  }
}

async function setupCdf(optionPricer) {
  if ((await optionPricer.cdf(cdf.keys[cdf.keys.length - 1])).toString(10) !== cdf.values[cdf.values.length - 1]) {
    const chunkSize = 50;
    console.log('setLn...');
    for (let i = 0; i < ln.keys.length; i += chunkSize) {
      await optionPricer.setLn(ln.keys.slice(i, i + chunkSize), ln.values.slice(i, i + chunkSize));
    }
    console.log('freezeLn...');
    await optionPricer.freezeLn();

    console.log('setCdf...');
    for (let i = 0; i < cdf.keys.length; i += chunkSize) {
      await optionPricer.setCdf(cdf.keys.slice(i, i + chunkSize), cdf.values.slice(i, i + chunkSize));
    }
    console.log('freezeCdf...');
    await optionPricer.freezeCdf();
  }
}

async function createChainlink(chainlinkContract, chainlinkProxyContract) {
  const chainlink = await deploy({ contract: chainlinkContract, args: [8] });
  chainlinkProxy = await deploy({
    contract: chainlinkProxyContract,
    deployed: async (c) => {
      console.log('chainlinkProxy.setChainlink...');
      await c.setChainlink(chainlink.address);

      if (oracle === 'chainlink-interim') {
        if (process.env.FEEDER) {
          await c.transferOwnership(process.env.FEEDER);
          await chainlink.transferOwnership(process.env.FEEDER);
        } else {
          console.log('should change owner');
        }
      }
    }
  });
  return chainlinkProxy.address;
}

// An example of a deploy script that will deploy and call a simple contract.
module.exports = async function (hre) {
  deployer = new Deployer(hre, wallet);

  const block = await ethers.provider.getBlock('latest');
  const usdc = await getOrDeploy(process.env.USDC, {
    contract: 'TestERC20',
    args: ['USDC', 'USDC', 6],
    deployed: async(c) => {
      console.log('usdc.mint...');
      await c.mint(process.env.DEPLOYER, '100000000000000000000000000000');
    }
  });
  let faucet;
  if (!isProduction) {
    faucet = await getOrDeploy(process.env.FAUCET, { contract: 'Faucet', args: [usdc.address] });
  }
  let oracleAddress;
  if (isChainlinkSystem) {
    oracleAddress = process.env.CHAINLINK_PROXY || chainlinkDeployable && await createChainlink(chainlinkContract, chainlinkProxyContract);
  } else {
    oracleAddress = process.env.PYTH;
  }
  const spotPricer = await getOrDeploy(process.env.SPOT_PRICER, {
    contract: spotPricerContract,
    deployed: async(c) => {
      if (oracleAddress) {
        console.log('spotPricer.initialize...');
        if (isChainlinkSystem) {
          await c.initialize(oracleAddress);
        } else if (oracle === 'pyth') {
          await c.initialize(oracleAddress, process.env.PYTH_PRICE_ID);
        }
      } else if (!isProduction) {
        console.log('spotPricer.setPrice...');
        await c.setPrice('1000000000000000000000'); // 1000
      } else {
        console.warn('should set Oracle');
      }
    }
  });
  if (!isProduction && oracleAddress && oracleAddress !== (await spotPricer.oracle())) {
    console.log('spotPricer.reinitialize...');
    await spotPricer.reinitialize(oracleAddress);
  }
  // const poolFactory = await getOrDeploy(process.env.FACTORY, { contract: 'PoolFactory' });
  const settler = await getOrDeploy(process.env.SETTLER, { contract: settlerContract });
  const optionPricer = await getOrDeploy(process.env.OPTION_PRICER, { contract: optionPricerContract });
  const optionMarket = await getOrDeploy(process.env.OPTION_MARKET, { contract: optionMarketContract });
  const vault = await deploy({ contract: vaultContract });
  const config = await deploy({ contract: 'Config' });

  console.log('vault.initialize...');
  await vault.initialize(config.address, spotPricer.address, optionPricer.address, optionMarket.address);

  console.log('config.initialize...');
  await config.initialize(vault.address, process.env.STAKEHOLDER, process.env.INSURANCE, usdc.address, 6);

  if (isProduction) {
    console.log('optionPricer.initialize...');
    await optionPricer.initialize(config.address);

    console.log('settler.initialize...');
    await settler.initialize(vault.address);
  } else {
    console.log('optionPricer.reinitialize...');
    await optionPricer.reinitialize(config.address, vault.address);

    console.log('optionMarket.setVault...');
    await optionMarket.setVault(vault.address);

    console.log('settler.reinitialize...');
    await settler.reinitialize(vault.address);

    console.log('spotPricer.setVault...');
    await spotPricer.setVault(vault.address);
  }

  await setupCdf(optionPricer);
  // await createPools(vault, config, poolFactory);
  await createPools(vault, config);

  console.log('=== api ===');
  console.log(`START_BLOCK=${block.number}`);
  console.log(`START_BLOCK_HASH=${block.hash}`);
  console.log(`VAULT=${vault.address.toLowerCase()}`);
  console.log(`CONFIG=${config.address.toLowerCase()}`);
  console.log(`OPTION_PRICER=${optionPricer.address.toLowerCase()}`);
  console.log(`OPTION_MARKET=${optionMarket.address.toLowerCase()}`);
  console.log(`SPOT_PRICER=${spotPricer.address.toLowerCase()}`);
  if (!isProduction) {
    console.log(`FAUCET=${faucet.address.toLowerCase()}`);
  }
  console.log(`SETTLER=${settler.address.toLowerCase()}`);
  if (oracleAddress) {
    if (isChainlinkSystem) {
      console.log(`CHAINLINK_PROXY=${oracleAddress.toLowerCase()}`);
    }
  }

  console.log('=== fe ===');
  console.log(`quote: '${usdc.address.toLowerCase()}',`);
  console.log(`spotPricer: '${spotPricer.address.toLowerCase()}',`);
  console.log(`optionPricer: '${optionPricer.address.toLowerCase()}',`);
  console.log(`vault: '${vault.address.toLowerCase()}',`);
  console.log(`config: '${config.address.toLowerCase()}'`);

  if (!isProduction) {
    console.log('=== contracts ===');
    console.log(`faucet: '${faucet.address.toLowerCase()}'`);
  }

  console.log('=== contract ===');
  console.log(`USDC=${usdc.address.toLowerCase()}`);
  console.log(`SPOT_PRICER=${spotPricer.address.toLowerCase()}`);
  console.log(`OPTION_PRICER=${optionPricer.address.toLowerCase()}`);
  console.log(`OPTION_MARKET=${optionMarket.address.toLowerCase()}`);
  // console.log(`FACTORY=${poolFactory.address.toLowerCase()}`);
  if (!isProduction) {
    console.log(`FAUCET=${faucet.address.toLowerCase()}`);
  }
  console.log(`SETTLER=${settler.address.toLowerCase()}`);
  if (oracleAddress) {
    if (isChainlinkSystem) {
      console.log(`CHAINLINK_PROXY=${oracleAddress.toLowerCase()}`);
    }
  }

  console.log('=== develop ===');
  console.log(`process.env.USDC='${usdc.address.toLowerCase()}'`);
  console.log(`process.env.SPOT_PRICER='${spotPricer.address.toLowerCase()}'`);
  console.log(`process.env.OPTION_PRICER='${optionPricer.address.toLowerCase()}'`);
  console.log(`process.env.OPTION_MARKET='${optionMarket.address.toLowerCase()}'`);
  // console.log(`process.env.FACTORY='${poolFactory.address.toLowerCase()}'`);
  if (!isProduction) {
    console.log(`process.env.FAUCET='${faucet.address.toLowerCase()}'`);
  }
  console.log(`process.env.SETTLER='${settler.address.toLowerCase()}'`);
}
