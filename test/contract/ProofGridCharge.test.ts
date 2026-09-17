import { expect } from "chai";
import type { Signer } from "ethers";
import { ethers } from "hardhat";
import { ProofGridCharge__factory } from "../../typechain-types";

async function deployProofGridCharge(owner: Signer) {
  const deployment = await ethers.deployContract("ProofGridCharge", [await owner.getAddress()]);
  return ProofGridCharge__factory.connect(await deployment.getAddress(), owner);
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
    const pricePerWh = 1_000n;
    const maxEnergyWh = 20_000n;
    const maximumPayment = 20_000_000n;
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3_600);

    const contract = await deployProofGridCharge(owner);
    await contract.waitForDeployment();
    await contract.configureChargingStation(
      stationId,
      operator.address,
      attestor.address,
      pricePerWh,
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
      pricePerWh,
      maxEnergyWh,
      maximumPayment,
      deadline,
      1n,
    ]);
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
    const [owner, driver, operator, attestor] = await ethers.getSigners();
    const contract = await deployProofGridCharge(owner);
    const stationId = ethers.id("inactive-station");
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3_600);
    await contract.configureChargingStation(stationId, operator.address, attestor.address, 1_000n, false);

    await expect(
      contract
        .connect(driver)
        .createChargingSession(ethers.id("session-inactive"), stationId, 20_000n, deadline, {
          value: 20_000_000n,
        }),
    ).to.be.revertedWithCustomError(contract, "InactiveChargingStation");
  });

  it("rejects a Charging Station with a zero Tariff", async function () {
    const [owner, driver, operator, attestor] = await ethers.getSigners();
    const contract = await deployProofGridCharge(owner);
    const stationId = ethers.id("zero-tariff-station");
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3_600);
    await contract.configureChargingStation(stationId, operator.address, attestor.address, 0n, true);

    await expect(
      contract
        .connect(driver)
        .createChargingSession(ethers.id("session-zero-tariff"), stationId, 20_000n, deadline),
    ).to.be.revertedWithCustomError(contract, "ZeroTariff");
  });

  it("rejects a zero maximum authorized energy amount", async function () {
    const [owner, driver, operator, attestor] = await ethers.getSigners();
    const contract = await deployProofGridCharge(owner);
    const stationId = ethers.id("station-zero-energy");
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3_600);
    await contract.configureChargingStation(stationId, operator.address, attestor.address, 1_000n, true);

    await expect(
      contract
        .connect(driver)
        .createChargingSession(ethers.id("session-zero-energy"), stationId, 0n, deadline),
    ).to.be.revertedWithCustomError(contract, "ZeroEnergy");
  });

  it("rejects a deadline that is not in the future", async function () {
    const [owner, driver, operator, attestor] = await ethers.getSigners();
    const contract = await deployProofGridCharge(owner);
    const stationId = ethers.id("station-invalid-deadline");
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp);
    await contract.configureChargingStation(stationId, operator.address, attestor.address, 1_000n, true);

    await expect(
      contract
        .connect(driver)
        .createChargingSession(ethers.id("session-invalid-deadline"), stationId, 20_000n, deadline, {
          value: 20_000_000n,
        }),
    ).to.be.revertedWithCustomError(contract, "InvalidDeadline");
  });

  it("rejects funding that does not exactly equal Maximum Payment", async function () {
    const [owner, driver, operator, attestor] = await ethers.getSigners();
    const contract = await deployProofGridCharge(owner);
    const stationId = ethers.id("station-wrong-funding");
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3_600);
    await contract.configureChargingStation(stationId, operator.address, attestor.address, 1_000n, true);

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
    const [owner, driver, operator, attestor] = await ethers.getSigners();
    const contract = await deployProofGridCharge(owner);
    const stationId = ethers.id("station-duplicate-session");
    const sessionId = ethers.id("duplicate-session");
    const deadline = BigInt((await ethers.provider.getBlock("latest"))!.timestamp + 3_600);
    await contract.configureChargingStation(stationId, operator.address, attestor.address, 1_000n, true);
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
