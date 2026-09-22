import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { ethers, network } from "hardhat";
import { readFujiReleaseConfig } from "./release-config";

async function main() {
  const configuration = readFujiReleaseConfig();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (network.name !== "fuji" || chainId !== 43_113) {
    throw new Error("Fuji deployment must run with --network fuji");
  }

  const [deployer] = await ethers.getSigners();
  const attestor = new ethers.Wallet(configuration.attestorPrivateKey);
  const stationIdHash = ethers.id(configuration.stationId);
  const deploymentStartedAt = Date.now();
  const contract = await ethers.deployContract("ProofGridCharge", [deployer.address]);
  const deploymentTransaction = contract.deploymentTransaction();
  if (!deploymentTransaction) throw new Error("deployment transaction was not created");
  const deploymentReceipt = await deploymentTransaction.wait();
  if (!deploymentReceipt) throw new Error("deployment transaction was not confirmed");

  const stationConfigurationStartedAt = Date.now();
  const configureTransaction = await contract.configureChargingStation(
    stationIdHash,
    configuration.chargingOperator,
    attestor.address,
    configuration.tariffWeiPerWh,
    true,
  );
  const configureReceipt = await configureTransaction.wait();
  if (!configureReceipt) throw new Error("Charging Station configuration was not confirmed");

  const publicDeployment = {
    chainId,
    contractAddress: await contract.getAddress(),
    rpcUrl: configuration.rpcUrl,
    attestorUrl: configuration.attestorUrl,
    stationId: configuration.stationId,
  };
  const evidence = {
    ...publicDeployment,
    deploymentTransaction: deploymentTransaction.hash,
    deploymentExplorer: `https://testnet.snowtrace.io/tx/${deploymentTransaction.hash}`,
    deploymentBlock: deploymentReceipt.blockNumber,
    deploymentGasUsed: deploymentReceipt.gasUsed.toString(),
    deploymentConfirmationMs: Date.now() - deploymentStartedAt,
    stationConfigurationTransaction: configureTransaction.hash,
    stationConfigurationExplorer: `https://testnet.snowtrace.io/tx/${configureTransaction.hash}`,
    stationConfigurationBlock: configureReceipt.blockNumber,
    stationConfigurationGasUsed: configureReceipt.gasUsed.toString(),
    stationConfigurationConfirmationMs: Date.now() - stationConfigurationStartedAt,
    stationIdHash,
    deployedAt: new Date().toISOString(),
  };
  await mkdir("web/public", { recursive: true });
  await mkdir("deployments", { recursive: true });
  await writeFile("web/public/deployment.json", `${JSON.stringify(publicDeployment, null, 2)}\n`);
  await writeFile("deployments/fuji.json", `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
