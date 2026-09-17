import { afterEach, describe, expect, it, vi } from "vitest";
import { toFunctionSelector, type EIP1193Provider } from "viem";
import { createBrowserChargeClient } from "./contract";

describe("browser contract client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("translates a decoded contract rejection into a Driver-readable reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            chainId: 31_337,
            contractAddress: "0x1111111111111111111111111111111111111111",
            rpcUrl: "http://127.0.0.1:8545",
            stationId: "station-fuji-001",
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = {
      async request({ method }: { method: string }) {
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "eth_chainId") return "0x7a69";
        if (method === "eth_requestAccounts") {
          return ["0x3333333333333333333333333333333333333333"];
        }
        if (method === "eth_sendTransaction") {
          throw Object.assign(new Error("execution reverted"), {
            data: toFunctionSelector("DuplicateChargingSession()"),
          });
        }
        throw new Error(`unexpected wallet method: ${method}`);
      },
    } as unknown as EIP1193Provider;
    Object.defineProperty(window, "ethereum", { configurable: true, value: provider });

    const client = await createBrowserChargeClient();
    await client.connectWallet();

    await expect(
      client.createSession({
        sessionId: "duplicate",
        stationId: "station-fuji-001",
        maxEnergyWh: 20_000n,
        maximumPayment: 20_000_000n,
        deadline: 1_789_635_600n,
      }),
    ).rejects.toThrow("该 Charging Session ID 已存在");
  });
});
