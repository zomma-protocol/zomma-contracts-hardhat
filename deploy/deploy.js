require('dotenv').config();

const { Wallet, ContractFactory } = require("zksync-web3");
// const zk = require("zksync-web3");
// const { HardhatRuntimeEnvironment } = require("hardhat/types");
const { Deployer } = require("@matterlabs/hardhat-zksync-deploy");
// const ethers = require("ethers");
const { ethers } = require('hardhat');
const { toDecimalStr, nextFriday, buildIv, mergeIv } = require('../scripts/helper');
const ln = require('../scripts/ln');
const cdf = require('../scripts/cdf');

// Get private key from the environment variable
const PRIVATE_KEY = process.env.PK || "";
if (!PRIVATE_KEY) {
  throw new Error("Please set ZKS_PRIVATE_KEY in the environment variables.");
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

async function createPools(vault, config, poolFactory) {
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

    await poolToken.initialize(pool.address, `Pool ${i} Share`, `P${i}-SHARE`);
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
    const chunkSize = 100;
    console.log('setLn...');
    // await optionPricer.setLn(ln.keys, ln.values);
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
  const faucet = await getOrDeploy(process.env.FAUCET, { contract: 'Faucet', args: [usdc.address] });
  const spotPricer = await getOrDeploy(process.env.SPOT_PRICER, {
    contract: 'TestSpotPricer',
    deployed: async(c) => {
      if (process.env.CHAINLINK_PROXY) {
        console.log('spotPricer.initialize...');
        await c.initialize(process.env.CHAINLINK_PROXY);
      } else {
        console.log('spotPricer.setPrice...');
        await c.setPrice('1000000000000000000000'); // 1000
      }
    }
  });
  let chainlinkProxy;
  if (process.env.TEST_CHAINLINK === '1') {
    const chainlink = await deploy({ contract: 'TestChainlink' });
    chainlinkProxy = await deploy({
      contract: 'TestChainlinkProxy',
      deployed: async (c) => {
        console.log('chainlinkProxy.setChainlink...');
        await c.setChainlink(chainlink.address);
      }
    });
    console.log('spotPricer.reinitialize...');
    await spotPricer.reinitialize(chainlinkProxy.address);
  }
  const poolFactory = await getOrDeploy(process.env.FACTORY, { contract: 'PoolFactory' });
  const settler = await getOrDeploy(process.env.SETTLER, { contract: 'TestSettler' });
  const optionPricer = await getOrDeploy(process.env.OPTION_PRICER, { contract: 'TestOptionPricer' });
  const vault = await deploy({ contract: 'TestVault' });
  const config = await deploy({ contract: 'Config' });

  console.log('vault.initialize...');
  await vault.initialize(config.address, spotPricer.address, optionPricer.address);

  console.log('config.initialize...');
  await config.initialize(vault.address, process.env.DEPLOYER, process.env.DEPLOYER, usdc.address, 6);

  console.log('optionPricer.reinitialize...');
  await optionPricer.reinitialize(config.address, vault.address);

  console.log('settler.reinitialize...');
  await settler.reinitialize(vault.address);

  console.log('spotPricer.setVault...');
  await spotPricer.setVault(vault.address);

  await setupCdf(optionPricer);
  await createPools(vault, config, poolFactory);

  console.log('=== api ===');
  console.log(`START_BLOCK=${block.number}`);
  console.log(`START_BLOCK_HASH=${block.hash}`);
  console.log(`VAULT=${vault.address.toLowerCase()}`);
  console.log(`CONFIG=${config.address.toLowerCase()}`);
  console.log(`OPTION_PRICER=${optionPricer.address.toLowerCase()}`);
  console.log(`SPOT_PRICER=${spotPricer.address.toLowerCase()}`);
  console.log(`FAUCET=${faucet.address.toLowerCase()}`);
  console.log(`SETTLER=${settler.address.toLowerCase()}`);
  if (process.env.TEST_CHAINLINK === '1') {
    console.log(`CHAINLINK_PROXY=${chainlinkProxy.address.toLowerCase()}`);
  }

  console.log('=== fe ===');
  console.log(`quote: '${usdc.address.toLowerCase()}',`);
  console.log(`spotPricer: '${spotPricer.address.toLowerCase()}',`);
  console.log(`optionPricer: '${optionPricer.address.toLowerCase()}',`);
  console.log(`vault: '${vault.address.toLowerCase()}',`);
  console.log(`config: '${config.address.toLowerCase()}'`);

  console.log('=== contracts ===');
  console.log(`faucet: '${faucet.address.toLowerCase()}'`);

  console.log('=== contract ===');
  console.log(`USDC=${usdc.address.toLowerCase()}`);
  console.log(`SPOT_PRICER=${spotPricer.address.toLowerCase()}`);
  console.log(`OPTION_PRICER=${optionPricer.address.toLowerCase()}`);
  console.log(`FACTORY=${poolFactory.address.toLowerCase()}`);
  console.log(`FAUCET=${faucet.address.toLowerCase()}`);
  console.log(`SETTLER=${settler.address.toLowerCase()}`);

  console.log('=== develop ===');
  console.log(`process.env.USDC='${usdc.address.toLowerCase()}'`);
  console.log(`process.env.SPOT_PRICER='${spotPricer.address.toLowerCase()}'`);
  console.log(`process.env.OPTION_PRICER='${optionPricer.address.toLowerCase()}'`);
  console.log(`process.env.FACTORY='${poolFactory.address.toLowerCase()}'`);
  console.log(`process.env.FAUCET='${faucet.address.toLowerCase()}'`);
  console.log(`process.env.SETTLER='${settler.address.toLowerCase()}'`);
}
