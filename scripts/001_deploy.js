// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.
require('dotenv').config();
const { ethers } = require('hardhat');
const {
  toDecimalStr,
  nextFriday,
  buildIv,
  mergeIv,
  deploy,
  getOrDeploy,
  deployProxy,
  getOrDeployProxy,
  logProxy,
  getEnvs
} = require('./helper');
const ln = require('./ln');
const cdf = require('./cdf');
const { ZERO_ADDRESS } = require('@openzeppelin/test-helpers/src/constants');

const {
  isProduction,
  optionPricerType,
  oracle,
  spotPricerContract,
  optionPricerContract,
  optionMarketContract,
  vaultContract,
  chainlinkContract,
  chainlinkProxyContract,
  poolFactoryContract,
  setIvs,
  chainlinkDeployable,
  isChainlinkSystem
} = getEnvs();

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
  if (setIvs) {
    console.log('setIv...');
    await optionMarket.setIv(mergeIv(data));
  }
  if (optionPricerType === 'lookup') {
    console.log('updateLookup...');
    await optionPricer.updateLookup(expiries);
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
    const salt = i.toString(16).padStart(64, '0');
    let result = await (await poolFactory.create(vault.address, `Pool ${i} Share`, `P${i}-SHARE`, `0x${salt}`)).wait();
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
  const chainlink = await deploy({
    contract: chainlinkContract,
    args: [8],
    deployed: async (c) => {
      if (chainlinkContract === 'InterimChainlinkOneinch') {
        await c.setAddresses(100, process.env.ONEINCH_SPOT, process.env.ONEINCH_ETH, process.env.ONEINCH_USDC)
      }
    }
  });
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
  } else if (oracle === 'pyth') {
    oracleAddress = process.env.PYTH;
  } else {
    oracleAddress = ZERO_ADDRESS;
  }
  const spotPricer = await getOrDeployProxy(process.env.SPOT_PRICER, {
    contract: spotPricerContract,
    deployed: async(c) => {
      if (oracleAddress) {
        console.log('spotPricer.initialize...');
        if (isChainlinkSystem) {
          await c.initialize(oracleAddress);
        } else if (oracle === 'pyth') {
          await c.initialize(oracleAddress, process.env.PYTH_PRICE_ID);
        } else {
          await c.initialize(oracleAddress);
        }
      } else if (!isProduction) {
        console.log('spotPricer.setPrice...');
        await c.setPrice('1000000000000000000000'); // 1000
      } else {
        console.warn('should set Oracle');
      }
    }
  });
  if (!isProduction && oracleAddress && oracleAddress.toLowerCase() !== (await spotPricer.oracle()).toLowerCase()) {
    console.log('spotPricer.reinitialize...');
    await spotPricer.reinitialize(oracleAddress);
  }
  const poolFactory = await getOrDeploy(process.env.FACTORY, { contract: poolFactoryContract });
  const settler = await getOrDeploy(process.env.SETTLER, { contract: 'Settler' });
  const optionPricer = await getOrDeployProxy(process.env.OPTION_PRICER, { contract: optionPricerContract });
  const optionMarket = await getOrDeployProxy(process.env.OPTION_MARKET, {
    contract: optionMarketContract,
    deployed: async(c) => {
      await c.initialize();
    }
  });
  const signatureValidator = await getOrDeployProxy(process.env.SIGNATURE_VALIDATOR, {
    contract: 'SignatureValidator',
    deployed: async(c) => {
      await c.initialize();
    }
  });
  const config = await deployProxy({ contract: 'Config' });
  const vault = await deployProxy({ contract: vaultContract });

  const rewardDistributor = await getOrDeployProxy(process.env.REWARD_DISTRIBUTOR, {
    contract: 'RewardDistributor',
    deployed: async(c) => {
      await c.initialize(vault.address);
    }
  });

  console.log('vault.initialize...');
  await vault.initialize(config.address, spotPricer.address, optionPricer.address, optionMarket.address, signatureValidator.address);

  console.log('config.initialize...');
  await config.initialize(vault.address, process.env.STAKEHOLDER || rewardDistributor.address, process.env.INSURANCE || rewardDistributor.address, usdc.address, 6);

  if (isProduction) {
    if (optionPricerType === 'lookup') {
      console.log('optionPricer.initialize...');
      await optionPricer.initialize(config.address);
    }
  } else {
    if (optionPricerType === 'lookup') {
      console.log('optionPricer.reinitialize...');
      await optionPricer.reinitialize(config.address, vault.address);
    }

    console.log('optionMarket.setVault...');
    await optionMarket.setVault(vault.address);

    if (oracle !== 'zomma') {
      console.log('spotPricer.setVault...');
      await spotPricer.setVault(vault.address);
    }
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
  console.log(`SPOT_PRICER=${spotPricer.address.toLowerCase()}`);
  console.log(`OPTION_PRICER=${optionPricer.address.toLowerCase()}`);
  console.log(`OPTION_MARKET=${optionMarket.address.toLowerCase()}`);
  console.log(`REWARD_DISTRIBUTOR=${rewardDistributor.address.toLowerCase()}`);
  console.log(`SIGNATURE_VALIDATOR=${signatureValidator.address.toLowerCase()}`);
  console.log(`SETTLER=${settler.address.toLowerCase()}`);
  if (!isProduction) {
    console.log(`FAUCET=${faucet.address.toLowerCase()}`);
  }
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
  console.log(`config: '${config.address.toLowerCase()}',`);
  console.log(`rewardDistributor: '${rewardDistributor.address.toLowerCase()}',`);
  console.log(`signatureValidator: '${signatureValidator.address.toLowerCase()}'`);

  if (!isProduction) {
    console.log('=== contracts ===');
    console.log(`faucet: '${faucet.address.toLowerCase()}'`);
  }

  console.log('=== contract ===');
  console.log(`USDC=${usdc.address.toLowerCase()}`);
  console.log(`VAULT=${vault.address.toLowerCase()}`);
  console.log(`CONFIG=${config.address.toLowerCase()}`);
  console.log(`SPOT_PRICER=${spotPricer.address.toLowerCase()}`);
  console.log(`OPTION_PRICER=${optionPricer.address.toLowerCase()}`);
  console.log(`OPTION_MARKET=${optionMarket.address.toLowerCase()}`);
  console.log(`FACTORY=${poolFactory.address.toLowerCase()}`);
  console.log(`REWARD_DISTRIBUTOR=${rewardDistributor.address.toLowerCase()}`);
  console.log(`SIGNATURE_VALIDATOR=${signatureValidator.address.toLowerCase()}`);
  console.log(`SETTLER=${settler.address.toLowerCase()}`);
  if (!isProduction) {
    console.log(`FAUCET=${faucet.address.toLowerCase()}`);
  }
  if (oracleAddress) {
    if (isChainlinkSystem) {
      console.log(`CHAINLINK_PROXY=${oracleAddress.toLowerCase()}`);
    }
  }

  await logProxy('VAULT', vault);
  await logProxy('CONFIG', config);
  await logProxy('SPOT_PRICER', spotPricer);
  await logProxy('OPTION_PRICER', optionPricer);
  await logProxy('OPTION_MARKET', optionMarket);
  await logProxy('REWARD_DISTRIBUTOR', rewardDistributor);
  await logProxy('SIGNATURE_VALIDATOR', signatureValidator);

  console.log('=== develop ===');
  console.log(`process.env.USDC='${usdc.address.toLowerCase()}'`);
  console.log(`process.env.VAULT=${vault.address.toLowerCase()}`);
  console.log(`process.env.CONFIG=${config.address.toLowerCase()}`);
  console.log(`process.env.SPOT_PRICER='${spotPricer.address.toLowerCase()}'`);
  console.log(`process.env.OPTION_PRICER='${optionPricer.address.toLowerCase()}'`);
  console.log(`process.env.OPTION_MARKET='${optionMarket.address.toLowerCase()}'`);
  console.log(`process.env.FACTORY='${poolFactory.address.toLowerCase()}'`);
  console.log(`process.env.REWARD_DISTRIBUTOR='${rewardDistributor.address.toLowerCase()}'`);
  console.log(`process.env.SIGNATURE_VALIDATOR='${signatureValidator.address.toLowerCase()}'`);
  console.log(`process.env.SETTLER='${settler.address.toLowerCase()}'`);
  if (!isProduction) {
    console.log(`process.env.FAUCET='${faucet.address.toLowerCase()}'`);
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
