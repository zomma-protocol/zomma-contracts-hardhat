const { ethers } = require('hardhat');
const { expect } = require('chai');
const BigNumber = require('bigNumber.js');
const _ = require('lodash');
const ln = require('../../scripts/ln');
const cdf = require('../../scripts/cdf');
const { getContractFactories: zkSyncGetContractFactories, createPool: zkSyncCreatePool, wallets } = require('./zksync');

const INT_MAX = '57896044618658097711785492504343953926634992332820282019728792003956564819967';
const MAX_IV = new BigNumber('0xffffffffffffff');
const ZKSYNC = process.env.ZKSYNC == '1';

async function expectRevert(actual, expected) {
  await expect(actual).to.be.revertedWith(expected);
}

function expectRevertCustom(actual, contract, customErrorName) {
  return expect(actual).to.be.revertedWithCustomError(contract, customErrorName);
}

async function getContractFactories(...contracts) {
  if (ZKSYNC) {
    return await zkSyncGetContractFactories(...contracts);
  }
  const contractFactories = [];
  for (let contract of contracts) {
    contractFactories.push(await ethers.getContractFactory(contract));
  }
  return contractFactories;
}

function buildIv(expiry, strike, isCall, isBuy, iv, disabled) {
  return { expiry, strike, isCall, isBuy, iv, disabled };
}

function mergeIv(ivs) {
  const marketMap = {};
  ivs.forEach((iv) => {
    let market = marketMap[iv.expiry];
    if (!market) {
      market = marketMap[iv.expiry] = {};
    }
    const sk = new BigNumber(iv.strike).toString(10);
    let sMarket = market[sk];
    if (!sMarket) {
      sMarket = market[sk] = {};
    }
    let csMarket = sMarket[iv.isCall];
    if (!csMarket) {
      csMarket = sMarket[iv.isCall] = {};
    }
    csMarket[iv.isBuy] = { iv: iv.iv, disabled: iv.disabled };
  });
  const markets = [];
  Object.keys(marketMap).forEach((expiry) => {
    const market = marketMap[expiry];
    Object.keys(market).forEach((sk) => {
      const strike = new BigNumber(sk);
      const sMarket = market[sk];
      const data = {
        expiry, strike,
        buyCallIv: new BigNumber(0),
        sellCallIv: new BigNumber(0),
        buyPutIv: new BigNumber(0),
        sellPutIv: new BigNumber(0),
        buyCallDisabled: false,
        sellCallDisabled: false,
        buyPutDisabled: false,
        sellPutDisabled: false
      };
      if (sMarket[true]) {
        if (sMarket[true][true]) {
          data.buyCallIv = sMarket[true][true].iv;
          data.buyCallDisabled = sMarket[true][true].disabled;
        }
        if (sMarket[true][false]) {
          data.sellCallIv = sMarket[true][false].iv;
          data.sellCallDisabled = sMarket[true][false].disabled;
        }
      }
      if (sMarket[false]) {
        if (sMarket[false][true]) {
          data.buyPutIv = sMarket[false][true].iv;
          data.buyPutDisabled = sMarket[false][true].disabled;
        }
        if (sMarket[false][false]) {
          data.sellPutIv = sMarket[false][false].iv;
          data.sellPutDisabled = sMarket[false][false].disabled;
        }
      }
      markets.push(...buildMarket(data));
    });
  });
  return markets;
}

function buildMarket({ expiry, strike, buyCallIv, sellCallIv, buyPutIv, sellPutIv, buyCallDisabled, sellCallDisabled, buyPutDisabled, sellPutDisabled }) {
  let temp = '0x';
  temp += _.padStart(new BigNumber(strike).toString(16), 54, '0');
  temp += _.padStart(new BigNumber(expiry).toString(16), 10, '0');

  let temp2 = '0x';
  temp2 += sellPutDisabled ? '1': '0';
  temp2 += buyPutDisabled ? '1': '0';
  temp2 += sellCallDisabled ? '1' : '0';
  temp2 += buyCallDisabled ? '1' : '0';
  temp2 += '0000';
  temp2 += formetIv(sellPutIv);
  temp2 += formetIv(buyPutIv);
  temp2 += formetIv(sellCallIv);
  temp2 += formetIv(buyCallIv);
  return [temp, temp2];
}

function formetIv(iv) {
  iv = new BigNumber(new BigNumber(iv).div(10**10).toFixed(0, BigNumber.ROUND_DOWN));
  iv = iv.gt(MAX_IV) ? MAX_IV : iv;
  return _.padStart(iv.toString(16), 14, '0');
}

function toBigNumber(value) {
  return new BigNumber(value);
}

function toDecimal(value, decimal = 18) {
  return new BigNumber(value).multipliedBy(10**decimal);
}

function toDecimalStr(value, decimal = 18) {
  return toDecimal(value, decimal).toFixed(0, BigNumber.ROUND_DOWN);
}

function fromDecimal(value, decimal = 18) {
  return new BigNumber(value.toString()).div(10**decimal);
}

function strFromDecimal(value, decimal = 18) {
  return fromDecimal(value, decimal).toString(10);
}

async function createOptionPricer(contract = 'TestCacheOptionPricer') {
  const [OptionPricer] = await getContractFactories(contract);
  const optionPricer = await OptionPricer.deploy();
  await optionPricer.setLn(ln.keys, ln.values);
  const chunkSize = 200;
  for (let i = 0; i < cdf.keys.length; i += chunkSize) {
    await optionPricer.setCdf(cdf.keys.slice(i, i + chunkSize), cdf.values.slice(i, i + chunkSize));
  }
  return optionPricer;
}

async function watchBalance(contract, addresses, func) {
  const before = [];
  const balanceChanges = [];
  for (const address of addresses) {
    before.push(await contract.balanceOf(address));
  }
  await func();
  for (let i = 0; i < addresses.length; ++i) {
    const after = await contract.balanceOf(addresses[i]);
    balanceChanges.push(after.sub(before[i]));
  }
  return balanceChanges;
}

async function createPool(poolFactory, ...args) {
  if (ZKSYNC) {
    return await zkSyncCreatePool(poolFactory, ...args);
  }
  const result = await (await poolFactory.create(...args)).wait();
  const create = result.events.find((e) => e.event === 'Create').args;
  const pool = await ethers.getContractAt('Pool', create.pool);
  const poolToken = await ethers.getContractAt('PoolToken', create.poolToken);
  return { pool, poolToken };
}

async function addPool(config, account) {
  await (await config.connect(account).enablePool()).wait();
  await config.addPool(account.address);
}

async function removePool(config, account) {
  await config.connect(account).enablePool();
  await config.removePool(account.address);
}

async function mintAndDeposit(vault, usdc, account, { decimals = 6, amount = 1000, mint = 1000 } = {}) {
  if (amount > mint) {
    mint = amount;
  }
  await usdc.mint(account.address, toDecimalStr(mint, decimals));
  await (await usdc.connect(account).approve(vault.address, toDecimalStr(100000000000, decimals))).wait();
  await vault.connect(account).deposit(toDecimalStr(amount));
}

async function getSigners() {
  if (ZKSYNC) {
    return wallets;
  }
  return await ethers.getSigners();
}

module.exports = {
  getSigners,
  expectRevert, expectRevertCustom, getContractFactories, createPool,
  INT_MAX, buildIv, mergeIv, buildMarket, watchBalance, addPool, removePool, mintAndDeposit,
  toBigNumber, toDecimal, toDecimalStr, fromDecimal, strFromDecimal, createOptionPricer
};
