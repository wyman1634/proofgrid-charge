import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { config as loadEnv } from "dotenv";
import { Wallet } from "ethers";

const sourceEnvironment = process.env.FUJI_KEYSTORE_ENV_PATH;
const keychainService = process.env.FUJI_KEYCHAIN_SERVICE;
const keychainAccount = process.env.FUJI_KEYCHAIN_ACCOUNT;

if (!sourceEnvironment || !existsSync(sourceEnvironment)) {
  throw new Error(
    "Encrypted Fuji keystore was not found. Set FUJI_KEYSTORE_ENV_PATH to its gitignored .env file.",
  );
}
if (!keychainService || !keychainAccount) {
  throw new Error("Set FUJI_KEYCHAIN_SERVICE and FUJI_KEYCHAIN_ACCOUNT before deploying with Keychain.");
}

const parsed = loadEnv({ path: sourceEnvironment, processEnv: {} }).parsed;
const encryptedKey = parsed?.DEPLOYER_PRIVATE_KEY_ENCRYPTED;
if (!encryptedKey) {
  throw new Error("DEPLOYER_PRIVATE_KEY_ENCRYPTED is missing from the encrypted Fuji keystore.");
}

const password = execFileSync(
  "security",
  ["find-generic-password", "-s", keychainService, "-a", keychainAccount, "-w"],
  { encoding: "utf8" },
).trim();
const deployer = await Wallet.fromEncryptedJson(encryptedKey, password);
const hardhat = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["hardhat", "run", "scripts/deploy-fuji.ts", "--network", "fuji"],
  {
    env: { ...process.env, FUJI_DEPLOYER_PRIVATE_KEY: deployer.privateKey },
    stdio: "inherit",
  },
);

hardhat.on("exit", code => process.exit(code ?? 1));
