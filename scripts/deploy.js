// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.
require('dotenv').config();
const { ethers } = require('hardhat');
const { toDecimalStr, nextFriday, buildIv, mergeIv } = require('./helper');
const ln = require('./ln');
const cdf = require('./cdf');

const isProduction = process.env.PRODUCTION === '1';
const oracle = process.env.ORACLE || 'chainlink';

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
    break;
  default: // chainlink
    spotPricerContract = isProduction ? 'SpotPricer' : 'TestSpotPricer';
    break;
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

async function setupIvs(optionMarket, optionPricer) {
  let expiry = nextFriday();
  const data = [];
  const expiries = [];
  const strikes = [];
  for (let i = 800; i <= 1300; i += 100) {
    strikes.push(toDecimalStr(i));
  }
  for (let i = 0; i < 4; ++i) {
    console.log(expiry, new Date(expiry * 1000));
    for (let strike of strikes) {
      data.push(buildIv(expiry, strike, true, true, toDecimalStr(0.8), false));
      data.push(buildIv(expiry, strike, true, false, toDecimalStr(0.8), false));
      data.push(buildIv(expiry, strike, false, true, toDecimalStr(0.8), false));
      data.push(buildIv(expiry, strike, false, false, toDecimalStr(0.8), false));
    }
    expiries.push(expiry);
    expiry += 86400 * 7;
  }
  console.log('setIv...');
  await optionMarket.setIv(mergeIv(data));
  console.log('updateLookup...');
  await optionPricer.updateLookup(expiries);
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
    let result = await (await poolFactory.create(vault.address, `Pool ${i} Share`, `P${i}-SHARE`)).wait();
    const create = result.events.find((e) => e.event === 'Create').args;
    console.log(create.pool);
    console.log('addPool...')
    await config.addPool(create.pool);
    const pool = await ethers.getContractAt('Pool', create.pool);
    const reservedRate = reservedRates[i] || reservedRates[0];
    console.log('setReservedRate...')
    await pool.setReservedRate(reservedRate);
    pools.push(create.pool);
  }
}

async function setupCdf(optionPricer) {
  if ((await optionPricer.cdf(cdf.keys[cdf.keys.length - 1])).toString(10) !== cdf.values[cdf.values.length - 1]) {
    console.log('setLn...');
    await optionPricer.setLn(ln.keys, ln.values);
    console.log('freezeLn...');
    await optionPricer.freezeLn();

    console.log('setCdf...');
    const chunkSize = 200;
    for (let i = 0; i < cdf.keys.length; i += chunkSize) {
      await optionPricer.setCdf(cdf.keys.slice(i, i + chunkSize), cdf.values.slice(i, i + chunkSize));
    }
    console.log('freezeCdf...');
    await optionPricer.freezeCdf();
  }
}

async function createChainlink(chainlinkContract, chainlinkProxyContract) {
  const chainlink = await deploy({ contract: chainlinkContract, args: [8] });
  const chainlinkProxy = await deploy({
    contract: chainlinkProxyContract,
    deployed: async (c) => {
      console.log(`${chainlinkProxyContract}.setChainlink...`);
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

async function main() {
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
  const poolFactory = await getOrDeploy(process.env.FACTORY, { contract: 'PoolFactory' });
  const settler = await getOrDeploy(process.env.SETTLER, { contract: settlerContract });
  const optionPricer = await getOrDeploy(process.env.OPTION_PRICER, { contract: optionPricerContract });
  const optionMarket = await getOrDeploy(process.env.OPTION_MARKET, { contract: optionMarketContract });
  const config = await deploy({ contract: 'Config' });
  const vault = await deploy({ contract: vaultContract });

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
  await createPools(vault, config, poolFactory);
  if (!isProduction) {
    await setupIvs(optionMarket, optionPricer);
  }

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
  console.log(`FACTORY=${poolFactory.address.toLowerCase()}`);
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
  console.log(`process.env.FACTORY='${poolFactory.address.toLowerCase()}'`);
  if (!isProduction) {
    console.log(`process.env.FAUCET='${faucet.address.toLowerCase()}'`);
  }
  console.log(`process.env.SETTLER='${settler.address.toLowerCase()}'`);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
