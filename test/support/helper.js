const { ethers } = require('hardhat');
const { expect } = require('chai');
const BigNumber = require('bigNumber.js');
const bs = require('black-scholes');
const ln = require('../../scripts/ln');
const cdf = require('../../scripts/cdf');
const { getContractFactories: zkSyncGetContractFactories, wallets } = require('./zksync');

const DEAD_ADDRESS = '0x000000000000000000000000000000000000dead';
const INT_MAX = '57896044618658097711785492504343953926634992332820282019728792003956564819967';
const MAX_IV = new BigNumber('0xffffffffffffff');
const ZKSYNC = process.env.ZKSYNC == '1';

async function expectRevert(actual, expected) {
  await expect(actual).to.be.revertedWith(expected);
}

async function expectRevertWithoutReason(actual) {
  await expect(actual).to.be.revertedWithoutReason();
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
  temp += new BigNumber(strike).toString(16).padStart(54, '0');
  temp += new BigNumber(expiry).toString(16).padStart(10, '0');

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
  return iv.toString(16).padStart(14, '0');
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

function buildData(mergedIvs, spot, ttl, skipCheckOwner) {
  let data = new BigNumber(ttl).toString(16).padStart(64, '0');
  data += new BigNumber(skipCheckOwner).toString(16).padStart(64, '0');
  mergedIvs.forEach((iv) => {
    data += iv.replace('0x', '');
  });
  data += new BigNumber(spot).toString(16).padStart(64, '0');
  data += new BigNumber(mergedIvs.length + 7).toString(16).padStart(64, '0');
  return data;
}

async function signData(verifyingContract, signer, ivs, spot, ttl, skipCheckOwner = 0) {
  const chainId = (await signer.provider.getNetwork()).chainId;
  const domain = {
    name: 'SignatureValidator',
    version: '1',
    chainId: chainId,
    verifyingContract: verifyingContract
  };

  const types = {
    Vault: [
      {name: 'deadline', type: 'uint256'},
      {name: 'skipCheckOwner', type: 'uint256'},
      {name: 'data', type: 'uint256[]'},
      {name: 'spot', type: 'uint256'},
      {name: 'dataLength', type: 'uint256'}
    ]
  };

  const mergedIvs = mergeIv(ivs.map((iv) => buildIv(...iv)));
  const value = {
    deadline: ttl, skipCheckOwner,
    data: mergedIvs,
    spot: spot,
    dataLength: mergedIvs.length + 7
  };
  const sig = await signer._signTypedData(
    domain,
    types,
    value
  );
  const vrs = ethers.utils.splitSignature(sig);
  const data = buildData(mergedIvs, spot, ttl, skipCheckOwner);
  return new BigNumber(vrs.v).toString(16).padStart(64, '0') + vrs.r.replace('0x', '') + vrs.s.replace('0x', '') + data;
}

function ivsToPrices(ivs, spot, now, rate = 0.06) {
  return ivs.map((iv) => {
    const newIv = [...iv];
    newIv[4] = toDecimalStr(bs.blackScholes(spot / 10**18, iv[1]  / 10**18, (iv[0] - now) / 31536000, iv[4] / 10**18, rate, iv[2] ? 'call' : 'put'));
    return newIv;
  });
}

function withSignedData(contract, signedData) {
  const wrapFunctions = {};
  Object.keys(contract.functions).forEach((func) => {
    let funcInterface = contract.interface.functions[func];
    if (!funcInterface) {
      const key = Object.keys(contract.interface.functions).find((k) => contract.interface.functions[k].name === func)
      funcInterface = contract.interface.functions[key];
    }
    const isCall = funcInterface.constant;
    wrapFunctions[func] = async (...args) => {
      const tx = await contract.populateTransaction[func](...args);
      tx.data += signedData;
      if (isCall) {
        const result = await contract.signer.call(tx);
        const decoded = contract.interface.decodeFunctionResult(funcInterface, result);
        return Array.isArray(decoded[0]) ? decoded[0] : decoded;
      } else {
        const txr = await contract.signer.sendTransaction(tx);
        const wait = txr.wait;
        txr.wait = async () => {
          const result = await wait();
          result.events = result.logs.map((log) => {
            try {
              return contract.interface.parseLog(log)
            } catch (e) {
              return log;
            }
          });
          return result;
        };
        return txr;
      }
    };
  });
  return wrapFunctions;
}

async function signTrade(signatureValidator, signer, data, deadline, gasFee, nonce = null) {
  const chainId = (await signer.provider.getNetwork()).chainId;
  const domain = {
    name: 'SignatureValidator',
    version: '1',
    chainId: chainId,
    verifyingContract: signatureValidator.address
  };

  const types = {
    Trade: [
      {name: 'data', type: 'int256[]'},
      {name: 'deadline', type: 'uint256'},
      {name: 'gasFee', type: 'uint256'},
      {name: 'nonce', type: 'uint256'}
    ]
  };
  if (nonce === null) {
    nonce = await signatureValidator.nonces(signer.address);
  }

  const value = { nonce, gasFee, data, deadline };
  const sig = await signer._signTypedData(
    domain,
    types,
    value
  );
  const vrs = ethers.utils.splitSignature(sig);
  return [data, deadline, gasFee, nonce, vrs.v, vrs.r, vrs.s];
}

async function signPoolWithdraw(signatureValidator, signer, shares, acceptableAmount, deadline, gasFee, nonce = null) {
  const chainId = (await signer.provider.getNetwork()).chainId;
  const domain = {
    name: 'SignatureValidator',
    version: '1',
    chainId: chainId,
    verifyingContract: signatureValidator.address
  };

  const types = {
    Withdraw: [
      {name: 'shares', type: 'uint256'},
      {name: 'acceptableAmount', type: 'uint256'},
      {name: 'deadline', type: 'uint256'},
      {name: 'gasFee', type: 'uint256'},
      {name: 'nonce', type: 'uint256'}
    ]
  };
  if (nonce === null) {
    nonce = await signatureValidator.nonces(signer.address);
  }

  const value = { nonce, gasFee, shares, acceptableAmount, deadline };
  const sig = await signer._signTypedData(
    domain,
    types,
    value
  );
  const vrs = ethers.utils.splitSignature(sig);
  return [shares, acceptableAmount, deadline, gasFee, nonce, vrs.v, vrs.r, vrs.s];
}

async function createOptionPricer(contract = 'TestCacheOptionPricer') {
  const [OptionPricer] = await getContractFactories(contract);
  const optionPricer = await OptionPricer.deploy();
  if (contract !== 'SignedOptionPricer') {
    await optionPricer.setLn(ln.keys, ln.values);
    const chunkSize = 200;
    for (let i = 0; i < cdf.keys.length; i += chunkSize) {
      await optionPricer.setCdf(cdf.keys.slice(i, i + chunkSize), cdf.values.slice(i, i + chunkSize));
    }
  }
  return optionPricer;
}

async function createSignatureValidator(contract = 'SignatureValidator') {
  const [SignatureValidator] = await getContractFactories(contract);
  const signatureValidator = await SignatureValidator.deploy();
  await signatureValidator.initialize();
  return signatureValidator;
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

async function createPool(vaultAddress, tokenName, tokenSymbol, poolContract = 'TestPool') {
  const [PoolToken, Pool] = await getContractFactories('PoolToken', poolContract);
  const poolToken = await PoolToken.deploy();
  const pool = await Pool.deploy();
  await poolToken.initialize(pool.address, tokenName, tokenSymbol);
  await (await pool.initialize(vaultAddress, poolToken.address)).wait();
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
  getSigners, signData, withSignedData, ivsToPrices, expectRevertWithoutReason,
  expectRevert, expectRevertCustom, getContractFactories, createPool, signTrade, signPoolWithdraw,
  INT_MAX, buildIv, mergeIv, buildMarket, watchBalance, addPool, removePool, mintAndDeposit,
  toBigNumber, toDecimal, toDecimalStr, fromDecimal, strFromDecimal, createOptionPricer, createSignatureValidator,
  DEAD_ADDRESS
};
