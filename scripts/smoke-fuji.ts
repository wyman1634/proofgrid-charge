import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { ethers, network } from "hardhat";
import { readFujiSmokeConfig } from "./fuji-smoke-config";

type AttestationResponse = {
  evidenceHash: string;
  actualEnergyWh: number;
  attestation: { expiry: number };
  signature: string;
};

async function mustReject(action: () => Promise<unknown>, scenario: string) {
  try {
    await action();
  } catch {
    return;
  }
  throw new Error(`${scenario} unexpectedly succeeded`);
}

function wait(milliseconds: number) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function refundFailedFunding(
  contract: Awaited<ReturnType<typeof ethers.getContractAt>>,
  sessionId: string,
  deadline: number,
) {
  const recoveryDeadline = Date.now() + 90_000;
  while (Date.now() < recoveryDeadline) {
    const latestBlock = await ethers.provider.getBlock("latest");
    if (latestBlock && latestBlock.timestamp > deadline) {
      const refundStartedAt = Date.now();
      const refundTransaction = await contract.timeoutRefund(sessionId);
      const refundReceipt = await refundTransaction.wait();
      if (!refundReceipt || refundReceipt.status !== 1) throw new Error("automatic smoke Timeout Refund failed");
      return {
        transaction: refundTransaction.hash,
        explorer: `https://testnet.snowtrace.io/tx/${refundTransaction.hash}`,
        block: refundReceipt.blockNumber,
        gasUsed: refundReceipt.gasUsed.toString(),
        confirmationMs: Date.now() - refundStartedAt,
      };
    }
    await wait(2_000);
  }
  throw new Error("automatic smoke Timeout Refund timed out; rerun with a new FUJI_SMOKE_SESSION_ID");
}

async function main() {
  const configuration = readFujiSmokeConfig();
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (network.name !== "fuji" || chainId !== 43_113) {
    throw new Error("Fuji smoke must run with --network fuji");
  }

  const [driver] = await ethers.getSigners();
  const contract = await ethers.getContractAt("ProofGridCharge", configuration.contractAddress, driver);
  const stationId = ethers.id(configuration.stationId);
  const sessionId = ethers.id(configuration.sessionName);
  const chargingStation = await contract.getChargingStation(stationId);
  const expectedAttestor = new ethers.Wallet(configuration.attestorPrivateKey).address;
  if (chargingStation.operator.toLowerCase() !== configuration.chargingOperator.toLowerCase()) {
    throw new Error("Fuji Charging Station operator does not match FUJI_CHARGING_OPERATOR_ADDRESS");
  }
  if (chargingStation.attestor.toLowerCase() !== expectedAttestor.toLowerCase()) {
    throw new Error("Fuji Charging Station attestor does not match PROOFGRID_ATTESTOR_PRIVATE_KEY");
  }
  const maximumEnergyWh = 20_000n;
  const maximumPayment = chargingStation.tariff * maximumEnergyWh;
  const currentBlock = await ethers.provider.getBlock("latest");
  if (!currentBlock) throw new Error("latest Fuji block is unavailable");
  const deadline = currentBlock.timestamp + 30;
  const expiry = currentBlock.timestamp + 1_800;

  const health = await fetch(`${configuration.attestorUrl}/healthz`);
  if (!health.ok) throw new Error(`Attestor health check returned HTTP ${health.status}`);
  const response = await fetch(`${configuration.attestorUrl}/attestations`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sessionId,
      stationId,
      chargingOperator: configuration.chargingOperator,
      rawChargingData: {
        sessionId,
        stationId,
        meterStartWh: 120_000,
        meterEndWh: 138_400,
      },
      expiry,
      chainId,
      verifyingContract: configuration.contractAddress,
    }),
  });
  if (!response.ok) throw new Error(`Attestor returned HTTP ${response.status}`);
  const signed = await response.json() as AttestationResponse;
  if (signed.actualEnergyWh <= 0 || BigInt(signed.actualEnergyWh) > maximumEnergyWh || signed.attestation.expiry <= currentBlock.timestamp) {
    throw new Error("Attestor preflight response is not settleable");
  }

  const fundedStartedAt = Date.now();
  const fundingTransaction = await contract.createChargingSession(
    sessionId,
    stationId,
    maximumEnergyWh,
    deadline,
    { value: maximumPayment },
  );
  const fundingReceipt = await fundingTransaction.wait();
  if (!fundingReceipt || fundingReceipt.status !== 1) throw new Error("Funding transaction failed on Fuji");
  const fundingConfirmationMs = Date.now() - fundedStartedAt;

  try {
    await mustReject(
      () => contract.settleChargingSession.staticCall(
        sessionId,
        BigInt(signed.actualEnergyWh) + 1n,
        signed.evidenceHash,
        signed.attestation.expiry,
        signed.signature,
      ),
      "tampered Actual Energy",
    );

    const settledStartedAt = Date.now();
    const settlementTransaction = await contract.settleChargingSession(
      sessionId,
      signed.actualEnergyWh,
      signed.evidenceHash,
      signed.attestation.expiry,
      signed.signature,
    );
    const settlementReceipt = await settlementTransaction.wait();
    if (!settlementReceipt || settlementReceipt.status !== 1) throw new Error("Settlement transaction failed on Fuji");
    const settlementConfirmationMs = Date.now() - settledStartedAt;

    await mustReject(
      () => contract.settleChargingSession.staticCall(
        sessionId,
        signed.actualEnergyWh,
        signed.evidenceHash,
        signed.attestation.expiry,
        signed.signature,
      ),
      "replayed Settlement",
    );

    const receipt = await contract.getChargingReceipt(sessionId);
    if (receipt.actualEnergyWh !== BigInt(signed.actualEnergyWh) || receipt.evidenceHash !== signed.evidenceHash) {
      throw new Error("public Charging Receipt did not match the Attestation");
    }
    if (receipt.settledAt === 0n) throw new Error("public Charging Receipt is missing its settlement time");

    const evidence = {
      chainId,
      contractAddress: configuration.contractAddress,
      sessionName: configuration.sessionName,
      sessionId,
      funding: {
        transaction: fundingTransaction.hash,
        explorer: `https://testnet.snowtrace.io/tx/${fundingTransaction.hash}`,
        block: fundingReceipt.blockNumber,
        gasUsed: fundingReceipt.gasUsed.toString(),
        confirmationMs: fundingConfirmationMs,
      },
      settlement: {
        transaction: settlementTransaction.hash,
        explorer: `https://testnet.snowtrace.io/tx/${settlementTransaction.hash}`,
        block: settlementReceipt.blockNumber,
        gasUsed: settlementReceipt.gasUsed.toString(),
        confirmationMs: settlementConfirmationMs,
      },
      receipt: {
        actualEnergyWh: receipt.actualEnergyWh.toString(),
        actualPayment: receipt.actualPayment.toString(),
        driverRefund: receipt.driverRefund.toString(),
        evidenceHash: receipt.evidenceHash,
        relayer: receipt.relayer,
        settledAt: receipt.settledAt.toString(),
      },
      rejectedScenarios: ["tampered Actual Energy", "replayed Settlement"],
      explorer: `https://testnet.snowtrace.io/address/${configuration.contractAddress}`,
      completedAt: new Date().toISOString(),
    };
    await mkdir("deployments/fuji-smoke", { recursive: true });
    await writeFile(`deployments/fuji-smoke/${configuration.sessionName}.json`, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
  } catch (error) {
    let recovery: Record<string, unknown> | undefined;
    try {
      const session = await contract.getChargingSession(sessionId);
      if (session.state === 1n) {
        recovery = { timeoutRefund: await refundFailedFunding(contract, sessionId, deadline) };
      }
    } catch (recoveryError) {
      recovery = { cleanupError: recoveryError instanceof Error ? recoveryError.message : String(recoveryError) };
    }
    const failureEvidence = {
      chainId,
      contractAddress: configuration.contractAddress,
      sessionName: configuration.sessionName,
      sessionId,
      funding: {
        transaction: fundingTransaction.hash,
        explorer: `https://testnet.snowtrace.io/tx/${fundingTransaction.hash}`,
        block: fundingReceipt.blockNumber,
        gasUsed: fundingReceipt.gasUsed.toString(),
        confirmationMs: fundingConfirmationMs,
      },
      failure: error instanceof Error ? error.message : String(error),
      recovery,
      completedAt: new Date().toISOString(),
    };
    await mkdir("deployments/fuji-smoke", { recursive: true });
    await writeFile(`deployments/fuji-smoke/${configuration.sessionName}.json`, `${JSON.stringify(failureEvidence, null, 2)}\n`);
    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
