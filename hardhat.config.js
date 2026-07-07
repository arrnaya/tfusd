require('dotenv').config();
require('@nomicfoundation/hardhat-toolbox');

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: '0.8.22',
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      forking: {
        url: process.env.BSC_MAINNET_RPC || 'https://bsc-rpc.publicnode.com',
        enabled: process.env.HARDHAT_FORK_ENABLED === 'true',
        blockNumber: process.env.HARDHAT_BLOCK_NUMBER && process.env.HARDHAT_BLOCK_NUMBER !== 'latest'
          ? parseInt(process.env.HARDHAT_BLOCK_NUMBER, 10)
          : undefined,
      },
      accounts: {
        count: 20,
        accountsBalance: '10000000000000000000000', // 10,000 ETH per account
      },
      mining: {
        auto: true,
        interval: 0,
      },
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    ethereum: {
      url: process.env.ETHEREUM_RPC || 'https://ethereum-rpc.publicnode.com',
      chainId: 1,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    polygon: {
      url: process.env.POLYGON_RPC || 'https://polygon-bor-rpc.publicnode.com',
      chainId: 137,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    bscMainnet: {
      url: process.env.BSC_MAINNET_RPC || 'https://bsc-rpc.publicnode.com',
      chainId: 56,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC || 'https://bsc-testnet-rpc.publicnode.com',
      chainId: 97,
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    // Etherscan API V2 uses a single Etherscan.io API key for all supported
    // chains. Pass it as a plain string to enable the V2 multichain endpoint.
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
    deployments: './deployments',
  },
  mocha: {
    timeout: 120000,
  },
};
