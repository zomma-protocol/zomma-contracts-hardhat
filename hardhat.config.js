require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  networks: {
    arbitrumGoerli: {
      url: process.env.NODE_URL || 'https://goerli-rollup.arbitrum.io/rpc',
      accounts: [process.env.PK]
    },
    ganache: {
      url: 'http://127.0.0.1:7545',
      accounts: [process.env.PK]
    }
  },
  solidity: {
    version: '0.8.17',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  mocha: {
    timeout: 100000
  }
};
