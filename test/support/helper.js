const { ethers } = require('hardhat');
const { expect } = require('chai');
const BigNumber = require('bigNumber.js');
const _ = require('lodash');
const ln = require('../../scripts/ln');
const cdf = require('../../scripts/cdf');

const INT_MAX = '57896044618658097711785492504343953926634992332820282019728792003956564819967';

async function expectRevert(actual, expected) {
  await expect(actual).to.be.revertedWith(expected);
}

async function getContractFactories(...contracts) {
  const contractFactories = [];
  for (let contract of contracts) {
    contractFactories.push(await ethers.getContractFactory(contract));
  }
  return contractFactories;
}

function buildIv(expiry, strike, isCall, isBuy, iv, disabled) {
  let temp = '0x';
  temp += disabled ? '1' : '0';
  temp += isCall ? '1' : '0';
  temp += isBuy ? '1': '0';
  temp += '000';
  temp += _.padStart(new BigNumber(iv).toString(16), 24, '0');
  temp += _.padStart(new BigNumber(strike).toString(16), 24, '0');
  temp += _.padStart(new BigNumber(expiry).toString(16), 10, '0');
  return temp;
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

async function createOptionPricer() {
  const [OptionPricer] = await getContractFactories('TestOptionPricer');
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
  const result = await (await poolFactory.create(...args)).wait();
  const create = result.events.find((e) => e.event === 'Create').args;
  const pool = await ethers.getContractAt('Pool', create.pool);
  const poolToken = await ethers.getContractAt('PoolToken', create.poolToken);
  return { pool, poolToken };
}

async function addPool(config, account) {
  await config.connect(account).enablePool();
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
  await usdc.connect(account).approve(vault.address, toDecimalStr(100000000000, decimals));
  await vault.connect(account).deposit(toDecimalStr(amount));
}

module.exports = {
  expectRevert, getContractFactories, createPool,
  INT_MAX, buildIv, watchBalance, addPool, removePool, mintAndDeposit,
  toBigNumber, toDecimal, toDecimalStr, fromDecimal, strFromDecimal, createOptionPricer
};
