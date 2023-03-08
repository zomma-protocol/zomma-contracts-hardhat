// We require the Hardhat Runtime Environment explicitly here. This is optional
// but useful for running the script in a standalone fashion through `node <script>`.
//
// You can also run a script with `npx hardhat run <script>`. If you do that, Hardhat
// will compile your contracts, add the Hardhat Runtime Environment's members to the
// global scope, and execute the script.
require('dotenv').config();
const { ethers } = require('hardhat');
const { toDecimalStr, nextFriday, buildIv } = require('./helper');
const ln = require('./ln');
const cdf = require('./cdf');

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

async function setupIvs(vault, optionPricer) {
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
  await vault.setIv(data);
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
  const config = await deploy({ contract: 'Config' });
  const vault = await deploy({ contract: 'TestVault' });

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
  await setupIvs(vault, optionPricer);

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

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
