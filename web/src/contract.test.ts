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
});
