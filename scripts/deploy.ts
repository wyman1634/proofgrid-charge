import { mkdir, writeFile } from "node:fs/promises";
import { ethers } from "hardhat";

async function main() {
  const [owner, , operator] = await ethers.getSigners();
  const attestorPrivateKey = process.env.PROOFGRID_ATTESTOR_PRIVATE_KEY;
  if (!attestorPrivateKey) {
    throw new Error("PROOFGRID_ATTESTOR_PRIVATE_KEY is required");
  }
  const attestor = new ethers.Wallet(attestorPrivateKey);
  const stationId = "station-fuji-001";
  const contract = await ethers.deployContract("ProofGridCharge", [owner.address]);
  await contract.waitForDeployment();
  await (
    await contract.configureChargingStation(
      ethers.id(stationId),
      operator.address,
      attestor.address,
      1_000n,
      true,
    )
  ).wait();

  const deployment = {
    chainId: Number((await ethers.provider.getNetwork()).chainId),
    contractAddress: await contract.getAddress(),
    rpcUrl: "http://127.0.0.1:8545",
    attestorUrl: "http://127.0.0.1:8080",
    stationId,
  };
  await mkdir("web/public", { recursive: true });
  await writeFile("web/public/deployment.json", `${JSON.stringify(deployment, null, 2)}\n`);
  console.log(`Configured ${stationId} at ${deployment.contractAddress}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
