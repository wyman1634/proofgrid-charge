import "@nomicfoundation/hardhat-toolbox";
import "dotenv/config";
import type { HardhatUserConfig } from "hardhat/config";

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      chainId: 1337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 1337,
    },
    fuji: {
      url: process.env.FUJI_RPC_URL ?? "https://api.avax-test.network/ext/bc/C/rpc",
      chainId: 43_113,
      accounts: process.env.FUJI_DEPLOYER_PRIVATE_KEY ? [process.env.FUJI_DEPLOYER_PRIVATE_KEY] : [],
    },
  },
  solidity: {
    version: "0.8.28",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
};

export default config;
