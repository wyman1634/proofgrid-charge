import { expect } from "chai";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import type { Signer } from "ethers";
import { ethers } from "hardhat";
import { ProofGridCharge__factory } from "../../typechain-types";

async function deployProofGridCharge(owner: Signer) {
  const deployment = await ethers.deployContract("ProofGridCharge", [await owner.getAddress()]);
  return ProofGridCharge__factory.connect(await deployment.getAddress(), owner);
}

async function availablePort() {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("failed to allocate test port");
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function startAttestorService(privateKey: string) {
  const port = await availablePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn("go", ["run", "./cmd/service"], {
    cwd: process.cwd(),
    env: {
      ...globalThis.process.env,
      PROOFGRID_SERVICE_ADDRESS: `127.0.0.1:${port}`,
      PROOFGRID_ATTESTOR_PRIVATE_KEY: privateKey,
    },
    stdio: "pipe",
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Go Attestor service exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${url}/healthz`);
      if (response.ok) return { url, stop: () => child.kill("SIGTERM") };
    } catch {
      // The service is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  child.kill("SIGTERM");
  throw new Error("Go Attestor service did not become ready");
}

async function configuredStation({
  stationName,
  tariff = 1_000n,
  active = true,
}: {
  stationName: string;
  tariff?: bigint;
  active?: boolean;
}) {
  const [owner, driver, operator, attestor] = await ethers.getSigners();
  const contract = await deployProofGridCharge(owner);
  const stationId = ethers.id(stationName);
  const currentTimestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
  await contract.configureChargingStation(stationId, operator.address, attestor.address, tariff, active);
  return { contract, driver, operator, attestor, stationId, currentTimestamp };
}

describe("Charging Session funding", function () {
  it("publishes a configured Charging Station", async function () {
    const [owner, , operator, attestor] = await ethers.getSigners();
    const contract = await deployProofGridCharge(owner);
    const stationId = ethers.id("station-fuji-001");

    await contract.configureChargingStation(stationId, operator.address, attestor.address, 1_000n, true);

    expect(await contract.getChargingStation(stationId)).to.deep.equal([
      operator.address,
      attestor.address,
      1_000n,
      true,
    ]);
  });

  it("lets a Driver fund a Session with the locked Charging Station terms", async function () {
    const [owner, driver, operator, attestor] = await ethers.getSigners();
    const stationId = ethers.id("station-fuji-001");
    const sessionId = ethers.id("session-001");
    const tariff = 1_000n;
    const maxEnergyWh = 20_000n;
    const maximumPayment = 20_000_000n;
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3_600);

    const contract = await deployProofGridCharge(owner);
    await contract.waitForDeployment();
    await contract.configureChargingStation(
      stationId,
      operator.address,
      attestor.address,
      tariff,
      true,
    );

    await expect(
      contract
        .connect(driver)
        .createChargingSession(sessionId, stationId, maxEnergyWh, deadline, {
          value: maximumPayment,
        }),
    )
      .to.emit(contract, "ChargingSessionFunded")
      .withArgs(sessionId, driver.address, stationId, maximumPayment);

    expect(await contract.getChargingSession(sessionId)).to.deep.equal([
      driver.address,
      stationId,
      operator.address,
      attestor.address,
      tariff,
      maxEnergyWh,
      maximumPayment,
      deadline,
      1n,
    ]);
    expect(await ethers.provider.getBalance(contract)).to.equal(maximumPayment);
  });

  it("rejects an unknown Charging Station", async function () {
    const [owner, driver] = await ethers.getSigners();
    const contract = await deployProofGridCharge(owner);
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3_600);

    await expect(
      contract
        .connect(driver)
        .createChargingSession(ethers.id("session-unknown"), ethers.id("unknown"), 20_000n, deadline),
    ).to.be.revertedWithCustomError(contract, "UnknownChargingStation");
  });

  it("rejects an inactive Charging Station", async function () {
    const { contract, driver, stationId, currentTimestamp } = await configuredStation({
      stationName: "inactive-station",
      active: false,
    });
    const deadline = BigInt(currentTimestamp + 3_600);

    await expect(
      contract
        .connect(driver)
        .createChargingSession(ethers.id("session-inactive"), stationId, 20_000n, deadline, {
          value: 20_000_000n,
        }),
    ).to.be.revertedWithCustomError(contract, "InactiveChargingStation");
  });

  it("rejects a Charging Station with a zero Tariff", async function () {
    const { contract, driver, stationId, currentTimestamp } = await configuredStation({
      stationName: "zero-tariff-station",
      tariff: 0n,
    });
    const deadline = BigInt(currentTimestamp + 3_600);

    await expect(
      contract
        .connect(driver)
        .createChargingSession(ethers.id("session-zero-tariff"), stationId, 20_000n, deadline),
    ).to.be.revertedWithCustomError(contract, "ZeroTariff");
  });

  it("rejects a zero maximum authorized energy amount", async function () {
    const { contract, driver, stationId, currentTimestamp } = await configuredStation({
      stationName: "station-zero-energy",
    });
    const deadline = BigInt(currentTimestamp + 3_600);

    await expect(
      contract
        .connect(driver)
        .createChargingSession(ethers.id("session-zero-energy"), stationId, 0n, deadline),
    ).to.be.revertedWithCustomError(contract, "ZeroEnergy");
  });

  it("rejects a deadline that is not in the future", async function () {
    const { contract, driver, stationId, currentTimestamp } = await configuredStation({
      stationName: "station-invalid-deadline",
    });
    const deadline = BigInt(currentTimestamp);

    await expect(
      contract
        .connect(driver)
        .createChargingSession(ethers.id("session-invalid-deadline"), stationId, 20_000n, deadline, {
          value: 20_000_000n,
        }),
    ).to.be.revertedWithCustomError(contract, "InvalidDeadline");
  });

  it("rejects funding that does not exactly equal Maximum Payment", async function () {
    const { contract, driver, stationId, currentTimestamp } = await configuredStation({
      stationName: "station-wrong-funding",
    });
    const deadline = BigInt(currentTimestamp + 3_600);

    await expect(
      contract
        .connect(driver)
        .createChargingSession(ethers.id("session-wrong-funding"), stationId, 20_000n, deadline, {
          value: 19_999_999n,
        }),
    )
      .to.be.revertedWithCustomError(contract, "IncorrectFunding")
      .withArgs(20_000_000n, 19_999_999n);
  });

  it("rejects a duplicate Charging Session identifier", async function () {
    const { contract, driver, stationId, currentTimestamp } = await configuredStation({
      stationName: "station-duplicate-session",
    });
    const sessionId = ethers.id("duplicate-session");
    const deadline = BigInt(currentTimestamp + 3_600);
    await contract
      .connect(driver)
      .createChargingSession(sessionId, stationId, 20_000n, deadline, { value: 20_000_000n });

    await expect(
      contract
        .connect(driver)
        .createChargingSession(sessionId, stationId, 20_000n, deadline, { value: 20_000_000n }),
    ).to.be.revertedWithCustomError(contract, "DuplicateChargingSession");
  });
});

describe("Charging Session Settlement", function () {
  it("settles a Charging Attestation once and conserves the Maximum Payment", async function () {
    const [owner, driver, operator, attestor, relayer] = await ethers.getSigners();
    const contract = await deployProofGridCharge(owner);
    await contract.waitForDeployment();
    const contractAddress = await contract.getAddress();
    const network = await ethers.provider.getNetwork();
    const stationId = ethers.id("station-fuji-001");
    const sessionId = ethers.id("session-settlement-001");
    const tariff = 1_000n;
    const maxEnergyWh = 20_000n;
    const maximumPayment = 20_000_000n;
    const actualEnergyWh = 18_400n;
    const actualPayment = 18_400_000n;
    const driverRefund = 1_600_000n;
    const currentTimestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
    const deadline = BigInt(currentTimestamp + 3_600);
    const expiry = BigInt(currentTimestamp + 1_800);
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("canonical charging evidence"));

    await contract.configureChargingStation(
      stationId,
      operator.address,
      attestor.address,
      tariff,
      true,
    );
    await contract
      .connect(driver)
      .createChargingSession(sessionId, stationId, maxEnergyWh, deadline, { value: maximumPayment });

    const signature = await attestor.signTypedData(
      {
        name: "ProofGrid Charge",
        version: "1",
        chainId: network.chainId,
        verifyingContract: contractAddress,
      },
      {
        ChargingAttestation: [
          { name: "sessionId", type: "bytes32" },
          { name: "stationId", type: "bytes32" },
          { name: "chargingOperator", type: "address" },
          { name: "actualEnergyWh", type: "uint256" },
          { name: "evidenceHash", type: "bytes32" },
          { name: "expiry", type: "uint256" },
        ],
      },
      { sessionId, stationId, chargingOperator: operator.address, actualEnergyWh, evidenceHash, expiry },
    );
    const operatorBalanceBefore = await ethers.provider.getBalance(operator.address);
    const driverBalanceBefore = await ethers.provider.getBalance(driver.address);

    await expect(
      contract
        .connect(relayer)
        .settleChargingSession(sessionId, actualEnergyWh, evidenceHash, expiry, signature),
    )
      .to.emit(contract, "ChargingSessionSettled")
      .withArgs(sessionId, relayer.address, actualPayment, driverRefund, evidenceHash);

    expect(await contract.getChargingSession(sessionId)).to.deep.equal([
      driver.address,
      stationId,
      operator.address,
      attestor.address,
      tariff,
      maxEnergyWh,
      maximumPayment,
      deadline,
      2n,
    ]);
    const chargingReceipt = await contract.getChargingReceipt(sessionId);
    expect(chargingReceipt.slice(0, 9)).to.deep.equal([
      driver.address,
      stationId,
      operator.address,
      attestor.address,
      tariff,
      actualEnergyWh,
      actualPayment,
      driverRefund,
      evidenceHash,
    ]);
    expect(chargingReceipt[9]).to.equal(relayer.address);
    expect(chargingReceipt[10]).to.be.greaterThan(0n);
    expect((await ethers.provider.getBalance(operator.address)) - operatorBalanceBefore).to.equal(actualPayment);
    expect((await ethers.provider.getBalance(driver.address)) - driverBalanceBefore).to.equal(driverRefund);
    expect(await ethers.provider.getBalance(contractAddress)).to.equal(0n);
    expect(actualPayment + driverRefund).to.equal(maximumPayment);
  });

  it("settles the Charging Attestation returned by the public Go API", async function () {
    this.timeout(30_000);
    const [owner, driver, operator, , relayer] = await ethers.getSigners();
    const attestorPrivateKey = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
    const attestor = new ethers.Wallet(attestorPrivateKey);
    const service = await startAttestorService(attestorPrivateKey);

    try {
      const contract = await deployProofGridCharge(owner);
      await contract.waitForDeployment();
      const stationId = ethers.id("station-api-001");
      const sessionId = ethers.id("session-api-001");
      const currentTimestamp = (await ethers.provider.getBlock("latest"))!.timestamp;
      const deadline = BigInt(currentTimestamp + 3_600);
      const expiry = currentTimestamp + 1_800;
      await contract.configureChargingStation(
        stationId,
        operator.address,
        attestor.address,
        1_000n,
        true,
      );
      await contract
        .connect(driver)
        .createChargingSession(sessionId, stationId, 20_000n, deadline, { value: 20_000_000n });

      const response = await fetch(`${service.url}/attestations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          stationId,
          chargingOperator: operator.address,
          meterStartWh: 120_000,
          meterEndWh: 138_400,
          expiry,
          chainId: Number((await ethers.provider.getNetwork()).chainId),
          verifyingContract: await contract.getAddress(),
        }),
      });
      expect(response.status).to.equal(200);
      const signed = await response.json() as {
        evidenceHash: string;
        actualEnergyWh: number;
        attestation: { expiry: number };
        signature: string;
      };
      const operatorBalanceBefore = await ethers.provider.getBalance(operator.address);
      const driverBalanceBefore = await ethers.provider.getBalance(driver.address);

      await contract.connect(relayer).settleChargingSession(
        sessionId,
        signed.actualEnergyWh,
        signed.evidenceHash,
        signed.attestation.expiry,
        signed.signature,
      );

      const receipt = await contract.getChargingReceipt(sessionId);
      expect(receipt[5]).to.equal(18_400n);
      expect(receipt[6]).to.equal(18_400_000n);
      expect(receipt[7]).to.equal(1_600_000n);
      expect(receipt[8]).to.equal(signed.evidenceHash);
      expect(receipt[9]).to.equal(relayer.address);
      expect(receipt[10]).to.be.greaterThan(0n);
      expect((await contract.getChargingSession(sessionId))[8]).to.equal(2n);
      const operatorPayment = (await ethers.provider.getBalance(operator.address)) - operatorBalanceBefore;
      const driverRefund = (await ethers.provider.getBalance(driver.address)) - driverBalanceBefore;
      expect(operatorPayment).to.equal(18_400_000n);
      expect(driverRefund).to.equal(1_600_000n);
      expect(operatorPayment + driverRefund).to.equal(20_000_000n);
      expect(await ethers.provider.getBalance(await contract.getAddress())).to.equal(0n);
    } finally {
      service.stop();
    }
  });
});
