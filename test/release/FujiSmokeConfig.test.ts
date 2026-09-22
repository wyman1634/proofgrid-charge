import { expect } from "chai";
import { readFujiSmokeConfig } from "../../scripts/fuji-smoke-config";

const environment = {
  FUJI_RPC_URL: "https://api.avax-test.network/ext/bc/C/rpc",
  FUJI_DEPLOYER_PRIVATE_KEY: `0x${"11".repeat(32)}`,
  PROOFGRID_ATTESTOR_PRIVATE_KEY: `0x${"22".repeat(32)}`,
  FUJI_CHARGING_OPERATOR_ADDRESS: "0x1111111111111111111111111111111111111111",
  FUJI_ATTESTOR_URL: "https://proofgrid-charge-attestor.onrender.com",
  FUJI_CONTRACT_ADDRESS: "0x2222222222222222222222222222222222222222",
};

describe("Fuji smoke configuration", () => {
  it("accepts a deployed contract and a reproducible Session ID", () => {
    expect(readFujiSmokeConfig({ ...environment, FUJI_SMOKE_SESSION_ID: "fuji-smoke-001" })).to.deep.include({
      contractAddress: environment.FUJI_CONTRACT_ADDRESS,
      sessionName: "fuji-smoke-001",
    });
  });

  it("rejects a missing contract address", () => {
    const { FUJI_CONTRACT_ADDRESS: _contractAddress, ...withoutContract } = environment;
    expect(() => readFujiSmokeConfig(withoutContract)).to.throw("FUJI_CONTRACT_ADDRESS is required");
  });
});
