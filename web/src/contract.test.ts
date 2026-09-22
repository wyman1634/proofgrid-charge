import { afterEach, describe, expect, it, vi } from "vitest";
import { toFunctionSelector, type EIP1193Provider } from "viem";
import { createBrowserChargeClient } from "./contract";

describe("browser contract client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(window, "ethereum", { configurable: true, value: undefined });
  });

  it("connects with MetaMask when another injected wallet owns window.ethereum", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            chainId: 1_337,
            contractAddress: "0x1111111111111111111111111111111111111111",
            rpcUrl: "http://127.0.0.1:8545",
            stationId: "station-fuji-001",
          }),
          { status: 200 },
        ),
      ),
    );
    const competingProvider = {
      request: vi.fn(async () => {
        throw { code: 4200, message: "Unsupported method" };
      }),
    };
    const metaMaskProvider = {
      isMetaMask: true,
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "eth_chainId") return "0x539";
        if (method === "eth_requestAccounts") {
          return ["0x3333333333333333333333333333333333333333"];
        }
        throw new Error(`unexpected MetaMask method: ${method}`);
      }),
    };
    Object.defineProperty(window, "ethereum", {
      configurable: true,
      value: Object.assign(competingProvider, {
        providers: [competingProvider, metaMaskProvider],
      }),
    });

    const client = await createBrowserChargeClient();

    await expect(client.connectWallet()).resolves.toBe(
      "0x3333333333333333333333333333333333333333",
    );
    expect(competingProvider.request).not.toHaveBeenCalled();
    expect(metaMaskProvider.request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x539" }],
    });
  });

  it("uses the EIP-6963 MetaMask identity instead of a compatible wallet flag", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            chainId: 1_337,
            contractAddress: "0x1111111111111111111111111111111111111111",
            rpcUrl: "http://127.0.0.1:8545",
            stationId: "station-fuji-001",
          }),
          { status: 200 },
        ),
      ),
    );
    const compatibleWallet = {
      isMetaMask: true,
      request: vi.fn(async () => {
        throw { code: 4200, message: "Compatible wallet was selected" };
      }),
    };
    const metaMaskProvider = {
      isMetaMask: true,
      request: vi.fn(async ({ method }: { method: string }) => {
        if (method === "eth_requestAccounts") {
          return ["0x3333333333333333333333333333333333333333"];
        }
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "eth_chainId") return "0x539";
        throw new Error(`unexpected MetaMask method: ${method}`);
      }),
    };
    Object.defineProperty(window, "ethereum", { configurable: true, value: compatibleWallet });
    const announceMetaMask = (event: Event) => {
      if (event.type !== "eip6963:requestProvider") return;
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: { uuid: "metamask", name: "MetaMask", icon: "data:image/svg+xml,", rdns: "io.metamask" },
            provider: metaMaskProvider,
          },
        }),
      );
    };
    window.addEventListener("eip6963:requestProvider", announceMetaMask);

    try {
      const client = await createBrowserChargeClient();
      await expect(client.connectWallet()).resolves.toBe(
        "0x3333333333333333333333333333333333333333",
      );
      expect(compatibleWallet.request).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("eip6963:requestProvider", announceMetaMask);
    }
  });

  it("shows a readable reason when an injected wallet returns a plain error object", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            chainId: 1_337,
            contractAddress: "0x1111111111111111111111111111111111111111",
            rpcUrl: "http://127.0.0.1:8545",
            stationId: "station-fuji-001",
          }),
          { status: 200 },
        ),
      ),
    );
    const provider = {
      request: vi.fn(async () => {
        throw { code: 4200, message: "Unsupported method" };
      }),
    } as unknown as EIP1193Provider;
    Object.defineProperty(window, "ethereum", { configurable: true, value: provider });

    const client = await createBrowserChargeClient();

    await expect(client.connectWallet()).rejects.toThrow(
      "当前钱包不支持切换本地网络，请在钱包中手动添加 Chain ID 1337",
    );
  });

  it("requests the Driver account before asking MetaMask to switch networks", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            chainId: 1_337,
            contractAddress: "0x1111111111111111111111111111111111111111",
            rpcUrl: "http://127.0.0.1:8545",
            stationId: "station-fuji-001",
          }),
          { status: 200 },
        ),
      ),
    );
    let authorized = false;
    const provider = {
      isMetaMask: true,
      async request({ method }: { method: string }) {
        if (method === "eth_requestAccounts") {
          authorized = true;
          return ["0x3333333333333333333333333333333333333333"];
        }
        if (method === "eth_chainId") return "0x539";
        if (method === "wallet_switchEthereumChain") {
          if (!authorized) throw { code: 4100, message: "Unauthorized" };
          return null;
        }
        throw new Error(`unexpected MetaMask method: ${method}`);
      },
    } as unknown as EIP1193Provider;
    Object.defineProperty(window, "ethereum", { configurable: true, value: provider });

    const client = await createBrowserChargeClient();

    await expect(client.connectWallet()).resolves.toBe(
      "0x3333333333333333333333333333333333333333",
    );
  });

  it("translates a decoded contract rejection into a Driver-readable reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            chainId: 1_337,
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
        if (method === "eth_chainId") return "0x539";
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

  it("identifies a replayed Settlement as an already-settled Charging Session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input).includes("/attestations")) {
          return new Response(
            JSON.stringify({
              rawChargingData: "{\"meterStartWh\":120000,\"meterEndWh\":138400}",
              evidenceHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
              actualEnergyWh: 18_400,
              attestation: { expiry: 1_789_635_600 },
              signature: "0x",
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            chainId: 1_337,
            contractAddress: "0x1111111111111111111111111111111111111111",
            rpcUrl: "http://127.0.0.1:8545",
            stationId: "station-fuji-001",
          }),
          { status: 200 },
        );
      }),
    );
    const provider = {
      async request({ method }: { method: string }) {
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "eth_chainId") return "0x539";
        if (method === "eth_requestAccounts") {
          return ["0x3333333333333333333333333333333333333333"];
        }
        if (method === "eth_sendTransaction") {
          throw Object.assign(new Error("execution reverted"), {
            data: toFunctionSelector("SessionAlreadySettled()"),
          });
        }
        throw new Error(`unexpected wallet method: ${method}`);
      },
    } as unknown as EIP1193Provider;
    Object.defineProperty(window, "ethereum", { configurable: true, value: provider });

    const client = await createBrowserChargeClient();
    await client.connectWallet();

    await expect(
      client.settleSession({
        hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
        state: "Funded",
        driver: "0x3333333333333333333333333333333333333333",
        sessionId: "already-settled",
        stationId: "station-fuji-001",
        operator: "0x2222222222222222222222222222222222222222",
        attestor: "0x4444444444444444444444444444444444444444",
        tariff: 1_000n,
        maxEnergyWh: 20_000n,
        maximumPayment: 20_000_000n,
        deadline: 1_789_635_600n,
      }),
    ).rejects.toThrow("Charging Session 已完成结算，不能重复提交");
  });

  it("caps simulated Charging Attestation energy at the Driver's authorized maximum", async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).includes("/attestations")) {
        const rawChargingData = JSON.parse(String(init?.body)).rawChargingData;
        expect(rawChargingData).toMatchObject({ meterStartWh: 120_000, meterEndWh: 121_000 });
        return new Response(
          JSON.stringify({
            rawChargingData: JSON.stringify(rawChargingData),
            evidenceHash: "0x0000000000000000000000000000000000000000000000000000000000000001",
            actualEnergyWh: 1_000,
            attestation: { expiry: 1_789_635_600 },
            signature: "0x",
          }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({
          chainId: 1_337,
          contractAddress: "0x1111111111111111111111111111111111111111",
          rpcUrl: "http://127.0.0.1:8545",
          stationId: "station-fuji-001",
        }),
        { status: 200 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const provider = {
      async request({ method }: { method: string }) {
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "eth_chainId") return "0x539";
        if (method === "eth_requestAccounts") return ["0x3333333333333333333333333333333333333333"];
        if (method === "eth_sendTransaction") throw new Error("stop after attestation request");
        throw new Error(`unexpected MetaMask method: ${method}`);
      },
    } as unknown as EIP1193Provider;
    Object.defineProperty(window, "ethereum", { configurable: true, value: provider });

    const client = await createBrowserChargeClient();
    await client.connectWallet();

    await expect(client.settleSession({
      hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
      state: "Funded",
      driver: "0x3333333333333333333333333333333333333333",
      sessionId: "small-authorization",
      stationId: "station-fuji-001",
      operator: "0x2222222222222222222222222222222222222222",
      attestor: "0x4444444444444444444444444444444444444444",
      tariff: 1_000n,
      maxEnergyWh: 1_000n,
      maximumPayment: 1_000_000n,
      deadline: 1_789_635_600n,
    })).rejects.toThrow("stop after attestation request");
  });

  it("translates a premature Timeout Refund into a Driver-readable reason", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            chainId: 1_337,
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
        if (method === "eth_chainId") return "0x539";
        if (method === "eth_requestAccounts") return ["0x3333333333333333333333333333333333333333"];
        if (method === "eth_sendTransaction") {
          throw Object.assign(new Error("execution reverted"), {
            data: toFunctionSelector("SessionNotExpired()"),
          });
        }
        throw new Error(`unexpected MetaMask method: ${method}`);
      },
    } as unknown as EIP1193Provider;
    Object.defineProperty(window, "ethereum", { configurable: true, value: provider });

    const client = await createBrowserChargeClient();
    await client.connectWallet();

    await expect(client.timeoutRefund({
      hash: "0x0000000000000000000000000000000000000000000000000000000000000001",
      state: "Funded",
      driver: "0x3333333333333333333333333333333333333333",
      sessionId: "refund-too-early",
      stationId: "station-fuji-001",
      operator: "0x2222222222222222222222222222222222222222",
      attestor: "0x4444444444444444444444444444444444444444",
      tariff: 1_000n,
      maxEnergyWh: 20_000n,
      maximumPayment: 20_000_000n,
      deadline: 1_789_635_600n,
    })).rejects.toThrow("Charging Session 尚未超过截止时间");
  });
});
