require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const RAW_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY;
const PRIVATE_KEY = RAW_PRIVATE_KEY
  ? (RAW_PRIVATE_KEY.startsWith("0x") ? RAW_PRIVATE_KEY : "0x" + RAW_PRIVATE_KEY)
  : undefined;
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY || "";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
        },
      },
      {
        version: "0.8.23",
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: "0.8.20",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
        },
      },
    ],
  },
  paths: {
    artifacts: "./artifacts",
    cache: "./cache",
    sources: "./contracts/verification-system",
    tests: "./test",
  },
  networks: {
    hardhat: {
      chainId: 31337,
      // GNOSIS_FORK=1 → fork mainnet Gnosis for a deploy dry-run against real on-chain state.
      ...(process.env.GNOSIS_FORK === "1"
        ? { forking: { url: process.env.GNOSIS_RPC_URL || "https://rpc.gnosischain.com" } }
        : {}),
    },
    base: {
      url: BASE_RPC_URL,
      chainId: 8453,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC_URL,
      chainId: 84532,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    gnosis: {
      url: process.env.GNOSIS_RPC_URL || "https://rpc.gnosischain.com",
      chainId: 100,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
  etherscan: {
    // Etherscan v2 unified API — single key works across all chains; the chain is
    // selected via the network name + chainId. Per-chain apiKey objects were
    // deprecated when Basescan/Etherscan v1 endpoints were sunset (May 2025).
    // Blockscout (gnosis) accepts any non-empty key; Etherscan v2 needs the real one.
    apiKey: {
      base: BASESCAN_API_KEY,
      baseSepolia: BASESCAN_API_KEY,
      gnosis: "blockscout",
    },
    customChains: [
      {
        network: "gnosis",
        chainId: 100,
        urls: {
          apiURL: "https://gnosis.blockscout.com/api",
          browserURL: "https://gnosis.blockscout.com",
        },
      },
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=8453",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "baseSepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api.etherscan.io/v2/api?chainid=84532",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};
