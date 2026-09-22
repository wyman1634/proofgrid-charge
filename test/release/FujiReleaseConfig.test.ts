import { expect } from "chai";
import { readFujiReleaseConfig } from "../../scripts/release-config";

describe("Fuji release configuration", () => {
  const complete = {
    FUJI_RPC_URL: "https://api.avax-test.network/ext/bc/C/rpc",
    FUJI_DEPLOYER_PRIVATE_KEY: `0x${"1".repeat(64)}`,
    PROOFGRID_ATTESTOR_PRIVATE_KEY: `0x${"2".repeat(64)}`,
    FUJI_CHARGING_OPERATOR_ADDRESS: "0x1111111111111111111111111111111111111111",
    FUJI_ATTESTOR_URL: "https://proofgrid-attestor.example.com",
  };

  it("accepts a complete Fuji configuration without exposing private keys", () => {
    const configuration = readFujiReleaseConfig(complete);

    expect(configuration).to.deep.equal({
      rpcUrl: complete.FUJI_RPC_URL,
      deployerPrivateKey: complete.FUJI_DEPLOYER_PRIVATE_KEY,
      attestorPrivateKey: complete.PROOFGRID_ATTESTOR_PRIVATE_KEY,
      chargingOperator: complete.FUJI_CHARGING_OPERATOR_ADDRESS,
      attestorUrl: complete.FUJI_ATTESTOR_URL,
      stationId: "station-fuji-001",
      tariffWeiPerWh: 1_000n,
    });
  });

  it("rejects missing Fuji secrets and local public endpoints", () => {
    expect(() => readFujiReleaseConfig({ ...complete, FUJI_DEPLOYER_PRIVATE_KEY: undefined }))
      .to.throw("FUJI_DEPLOYER_PRIVATE_KEY is required");
    expect(() => readFujiReleaseConfig({ ...complete, FUJI_ATTESTOR_URL: "http://127.0.0.1:8080" }))
      .to.throw("FUJI_ATTESTOR_URL must use https");
  });
});
