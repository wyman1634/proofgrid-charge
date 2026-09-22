import { expect } from "chai";
import { readPublicFujiDeployment } from "../../scripts/public-deployment-config";

const publicDeployment = JSON.stringify({
  chainId: 43113,
  contractAddress: "0x1111111111111111111111111111111111111111",
  rpcUrl: "https://api.avax-test.network/ext/bc/C/rpc",
  attestorUrl: "https://proofgrid-charge-attestor.onrender.com",
  stationId: "station-fuji-001",
});

describe("public Fuji deployment configuration", () => {
  it("allows only public deployment fields", () => {
    expect(readPublicFujiDeployment(publicDeployment)).to.deep.equal(JSON.parse(publicDeployment));
  });

  it("rejects a secret or unknown field before Pages publication", () => {
    expect(() => readPublicFujiDeployment(JSON.stringify({
      ...JSON.parse(publicDeployment),
      attestorPrivateKey: `0x${"11".repeat(32)}`,
    }))).to.throw("must not contain unknown or secret fields");
  });

  it("rejects public URLs that embed credentials or query tokens", () => {
    expect(() => readPublicFujiDeployment(JSON.stringify({
      ...JSON.parse(publicDeployment),
      rpcUrl: "https://token@api.avax-test.network/ext/bc/C/rpc?api_key=private",
    }))).to.throw("URLs must use a public HTTPS hostname");
  });

  it("rejects loopback and private IP endpoints from the public bundle", () => {
    for (const url of ["https://127.0.0.1", "https://[::1]"]) {
      expect(() => readPublicFujiDeployment(JSON.stringify({
        ...JSON.parse(publicDeployment),
        attestorUrl: url,
      }))).to.throw("URLs must use a public HTTPS hostname");
    }
  });
});
