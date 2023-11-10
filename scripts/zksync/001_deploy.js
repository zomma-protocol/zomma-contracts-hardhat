require('dotenv').config();

const { ethers } = require('hardhat');
const {
  deploy,
  getOrDeploy,
  deployProxy,
  getOrDeployProxy,
  getEnvs
} = require('./helper');
const { toDecimalStr, logProxy } = require('../helper');
const ln = require('../ln');
const cdf = require('../cdf');
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
  chainlinkDeployable,
  isChainlinkSystem,
  poolContract
} = getEnvs();

async function createPools(vault, config, signatureValidator) {
  const reservedRates = [
    toDecimalStr(0.3),
    toDecimalStr(0.2),
    toDecimalStr(0.1),
    toDecimalStr(0)
  ];
  const addedPools = await config.getPools();
  for (let i = addedPools.length; i < 2; ++i) {
    console.log(`create pool ${i}...`);
    const poolToken = await deployProxy({ contract: 'PoolToken' });
    const pool = await deployProxy({ contract: poolContract });
    console.log('poolToken.initialize...');
    await poolToken.initialize(pool.address, `Pool ${i} Share`, `P${i}-SHARE`);
    console.log('pool.initialize...');
    await (await pool.initialize(vault.address, poolToken.address)).wait();
    console.log('addPool...')
    await config.addPool(pool.address);
    const reservedRate = reservedRates[i] || reservedRates[0];
    console.log('setReservedRate...')
    await pool.setReservedRate(reservedRate);
    console.log('grant user role...');
    await signatureValidator.grantRole('0x2db9fd3d099848027c2383d0a083396f6c41510d7acfd92adc99b6cffcf31e96', pool.address);
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
  const chainlink = await deploy({
    contract: chainlinkContract,
    args: [8],
    deployed: async (c) => {
      if (chainlinkContract === 'InterimChainlinkOneinch') {
        await c.setAddresses(100, process.env.ONEINCH_SPOT, process.env.ONEINCH_ETH, process.env.ONEINCH_USDC)
      }
    }
  });
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
  const settler = await getOrDeploy(process.env.SETTLER, { contract: 'Settler' });
  const optionPricer = await getOrDeployProxy(process.env.OPTION_PRICER, { contract: optionPricerContract });
  const optionMarket = await getOrDeployProxy(process.env.OPTION_MARKET, {
    contract: optionMarketContract,
    deployed: async (c) => {
      await c.initialize();
    }
  });
  const signatureValidator = await getOrDeployProxy(process.env.SIGNATURE_VALIDATOR, {
    contract: 'SignatureValidator',
    deployed: async(c) => {
      await c.initialize();
    }
  });
  const vault = await deployProxy({ contract: vaultContract });
  const config = await deployProxy({ contract: 'Config' });

  const rewardDistributor = await getOrDeployProxy(process.env.REWARD_DISTRIBUTOR, {
    contract: 'RewardDistributor',
    deployed: async(c) => {
      await c.initialize(vault.address);
    }
  });

  console.log('vault.initialize...');
  await vault.initialize(config.address, spotPricer.address, optionPricer.address, optionMarket.address, signatureValidator.address);

  console.log('grant user role...');
  await signatureValidator.grantRole('0x2db9fd3d099848027c2383d0a083396f6c41510d7acfd92adc99b6cffcf31e96', vault.address);

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
  await createPools(vault, config, signatureValidator);

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
  console.log(`USDC=${usdc.address}`);
  console.log(`VAULT=${vault.address}`);
  console.log(`CONFIG=${config.address}`);
  console.log(`SPOT_PRICER=${spotPricer.address}`);
  console.log(`OPTION_PRICER=${optionPricer.address}`);
  console.log(`OPTION_MARKET=${optionMarket.address}`);
  console.log(`REWARD_DISTRIBUTOR=${rewardDistributor.address}`);
  console.log(`SIGNATURE_VALIDATOR=${signatureValidator.address}`);
  console.log(`SETTLER=${settler.address}`);
  if (!isProduction) {
    console.log(`FAUCET=${faucet.address}`);
  }
  if (oracleAddress) {
    if (isChainlinkSystem) {
      console.log(`CHAINLINK_PROXY=${oracleAddress}`);
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
  console.log(`process.env.REWARD_DISTRIBUTOR='${rewardDistributor.address.toLowerCase()}'`);
  console.log(`process.env.SIGNATURE_VALIDATOR='${signatureValidator.address.toLowerCase()}'`);
  console.log(`process.env.SETTLER='${settler.address.toLowerCase()}'`);
  if (!isProduction) {
    console.log(`process.env.FAUCET='${faucet.address.toLowerCase()}'`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
