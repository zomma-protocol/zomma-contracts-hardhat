require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');
require('@openzeppelin/hardhat-upgrades');
require('@matterlabs/hardhat-zksync-deploy');
require('@matterlabs/hardhat-zksync-solc');
require('@matterlabs/hardhat-zksync-upgradable');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  // defaultNetwork: 'zkSyncTestnet',
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
      url: 'https://mainnet.era.zksync.io',
      ethNetwork: 'https://eth-rpc.gateway.pokt.network', // Can also be the RPC URL of the network (e.g. `https://goerli.infura.io/v3/<API_KEY>`)
      zksync: true
    },
    zkSyncTestnet: {
      url: 'https://zksync2-testnet.zksync.dev',
      ethNetwork: 'goerli', // Can also be the RPC URL of the network (e.g. `https://goerli.infura.io/v3/<API_KEY>`)
      zksync: true
    },
    zkSyncLocal: {
      url: 'http://localhost:3050',
      ethNetwork: 'http://localhost:8545',
      zksync: true,
    },
    linea: {
      url: 'https://rpc.goerli.linea.build/',
      accounts: [process.env.PK],
    },
    scrollAlpha: {
      url: 'https://alpha-rpc.scroll.io/l2',
      accounts: [process.env.PK],
    },
  },
  zksolc: {
    version: '1.3.14',
    compilerSource: 'binary',
    settings: {
      optimizer: {
        enabled: true,
        mode: 'z',
      },
    }
  },
  solidity: {
    version: '0.8.20',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  mocha: {
    timeout: 200000
  }
};
