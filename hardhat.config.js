require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');
require("@matterlabs/hardhat-zksync-deploy");
require("@matterlabs/hardhat-zksync-solc");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // defaultNetwork: "zkSyncTestnet",
  networks: {
    arbitrumGoerli: {
      url: process.env.NODE_URL || 'https://goerli-rollup.arbitrum.io/rpc',
      accounts: [process.env.PK]
    },
    ganache: {
      url: 'http://127.0.0.1:7545',
      accounts: [process.env.PK]
    },
    zkSync: {
      url: "https://mainnet.era.zksync.io",
      ethNetwork: "https://eth-rpc.gateway.pokt.network", // Can also be the RPC URL of the network (e.g. `https://goerli.infura.io/v3/<API_KEY>`)
      zksync: true
    },
    zkSyncTestnet: {
      url: "https://zksync2-testnet.zksync.dev",
      ethNetwork: "goerli", // Can also be the RPC URL of the network (e.g. `https://goerli.infura.io/v3/<API_KEY>`)
      zksync: true
    },
    zkSyncLocal: {
      url: "http://localhost:3050",
      ethNetwork: "http://localhost:8545",
      zksync: true,
    }
  },
  zksolc: {
    version: "1.3.8",
    compilerSource: "binary",
    settings: {
      optimizer: {
        enabled: true,
        mode: "z",
      },
    }
  },
  solidity: {
    version: '0.8.18',
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
