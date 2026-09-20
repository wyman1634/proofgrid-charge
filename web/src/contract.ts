import {
  createPublicClient,
  createWalletClient,
  custom,
  decodeErrorResult,
  http,
  keccak256,
  toBytes,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { hardhat } from "viem/chains";
import type { ChargeClient, CreateSessionRequest, FundedSession } from "./ChargingSessionPage";

const abi = [
  { type: "error", name: "UnknownChargingStation", inputs: [] },
  { type: "error", name: "InactiveChargingStation", inputs: [] },
  { type: "error", name: "ZeroTariff", inputs: [] },
  { type: "error", name: "ZeroEnergy", inputs: [] },
  { type: "error", name: "InvalidDeadline", inputs: [] },
  {
    type: "error",
    name: "IncorrectFunding",
    inputs: [
      { name: "expected", type: "uint256" },
      { name: "actual", type: "uint256" },
    ],
  },
  { type: "error", name: "DuplicateChargingSession", inputs: [] },
  { type: "error", name: "InvalidSessionState", inputs: [] },
  { type: "error", name: "InvalidAttestation", inputs: [] },
  {
    type: "function",
    name: "getChargingStation",
    stateMutability: "view",
    inputs: [{ name: "stationId", type: "bytes32" }],
    outputs: [
      { name: "operator", type: "address" },
      { name: "attestor", type: "address" },
      { name: "tariff", type: "uint256" },
      { name: "active", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "createChargingSession",
    stateMutability: "payable",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "stationId", type: "bytes32" },
      { name: "maxEnergyWh", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getChargingSession",
    stateMutability: "view",
    inputs: [{ name: "sessionId", type: "bytes32" }],
    outputs: [
      { name: "driver", type: "address" },
      { name: "stationId", type: "bytes32" },
      { name: "operator", type: "address" },
      { name: "attestor", type: "address" },
      { name: "tariff", type: "uint256" },
      { name: "maxEnergyWh", type: "uint256" },
      { name: "maximumPayment", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "state", type: "uint8" },
    ],
  },
  {
    type: "function",
    name: "settleChargingSession",
    stateMutability: "nonpayable",
    inputs: [
      { name: "sessionId", type: "bytes32" },
      { name: "actualEnergyWh", type: "uint256" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "expiry", type: "uint256" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "getChargingReceipt",
    stateMutability: "view",
    inputs: [{ name: "sessionId", type: "bytes32" }],
    outputs: [
      { name: "driver", type: "address" },
      { name: "stationId", type: "bytes32" },
      { name: "operator", type: "address" },
      { name: "attestor", type: "address" },
      { name: "tariff", type: "uint256" },
      { name: "actualEnergyWh", type: "uint256" },
      { name: "actualPayment", type: "uint256" },
      { name: "driverRefund", type: "uint256" },
      { name: "evidenceHash", type: "bytes32" },
      { name: "relayer", type: "address" },
      { name: "settledAt", type: "uint256" },
    ],
  },
] as const;

type Deployment = {
  chainId: number;
  contractAddress: Address;
  rpcUrl: string;
  stationId: string;
  attestorUrl?: string;
};

type AttestationResponse = {
  rawChargingData: string;
  evidenceHash: Hex;
  actualEnergyWh: number;
  attestation: {
    expiry: number;
  };
  signature: Hex;
};

type InjectedProvider = EIP1193Provider & {
  isMetaMask?: boolean;
  providers?: InjectedProvider[];
};

declare global {
  interface Window {
    ethereum?: InjectedProvider;
  }
}

async function selectInjectedProvider() {
  const injected = window.ethereum;
  let announcedMetaMask: InjectedProvider | undefined;
  const handleAnnouncement = (event: Event) => {
    const detail = (event as CustomEvent<{
      info?: { name?: string; rdns?: string };
      provider?: InjectedProvider;
    }>).detail;
    if (detail?.provider && (detail.info?.rdns === "io.metamask" || detail.info?.name === "MetaMask")) {
      announcedMetaMask = detail.provider;
    }
  };
  window.addEventListener("eip6963:announceProvider", handleAnnouncement);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  window.removeEventListener("eip6963:announceProvider", handleAnnouncement);

  if (announcedMetaMask) return announcedMetaMask;
  if (!injected) return undefined;
  return injected.providers?.find((provider) => provider.isMetaMask) ?? injected;
}

function collectHexData(value: unknown, seen = new Set<unknown>()): Hex[] {
  if (typeof value === "string") {
    return [...value.matchAll(/0x[0-9a-fA-F]{8,}/g)].map(([match]) => match as Hex);
  }
  if (typeof value !== "object" || value === null || seen.has(value)) return [];
  seen.add(value);
  const record = value as Record<string, unknown>;
  return ["data", "cause", "error", "details", "shortMessage", "message"]
    .flatMap((key) => collectHexData(record[key], seen));
}

function decodedErrorName(reason: unknown) {
  for (const data of collectHexData(reason)) {
    try {
      return decodeErrorResult({ abi, data }).errorName;
    } catch {
      // The candidate may be transaction calldata rather than revert data.
    }
  }
  return undefined;
}

function errorField(reason: unknown, field: "code" | "message", seen = new Set<unknown>()): unknown {
  if (typeof reason !== "object" || reason === null || seen.has(reason)) return undefined;
  seen.add(reason);
  const record = reason as Record<string, unknown>;
  if (record[field] !== undefined) return record[field];
  for (const key of ["cause", "error", "data"]) {
    const nested = errorField(record[key], field, seen);
    if (nested !== undefined) return nested;
  }
  return undefined;
}

function friendlyError(reason: unknown) {
  const nestedMessage = errorField(reason, "message");
  const message = reason instanceof Error
    ? reason.message
    : typeof nestedMessage === "string"
      ? nestedMessage
      : typeof reason === "string"
        ? reason
        : "钱包请求失败，请检查钱包状态";
  const code = errorField(reason, "code");
  const walletErrors = new Map<unknown, string>([
    [4001, "Driver 已取消钱包请求"],
    [4100, "钱包尚未授权，请重新连接"],
    [4200, "当前钱包不支持切换本地网络，请在钱包中手动添加 Chain ID 31337"],
  ]);
  if (walletErrors.has(code)) return new Error(walletErrors.get(code));
  const knownErrors: Array<[string, string]> = [
    ["UnknownChargingStation", "该 Charging Station 未登记"],
    ["DuplicateChargingSession", "该 Charging Session ID 已存在"],
    ["InactiveChargingStation", "该 Charging Station 当前不可用"],
    ["ZeroTariff", "该 Charging Station 的 Tariff 无效"],
    ["ZeroEnergy", "最大授权电量必须大于零"],
    ["IncorrectFunding", "出资金额必须准确等于 Maximum Payment"],
    ["InvalidDeadline", "截止时间必须晚于当前时间"],
    ["User rejected", "Driver 已取消钱包请求"],
  ];
  const errorName = decodedErrorName(reason);
  return new Error(knownErrors.find(([name]) => name === errorName || message.includes(name))?.[1] ?? message);
}

export async function createBrowserChargeClient(): Promise<ChargeClient> {
  const deploymentResponse = await fetch("/deployment.json");
  if (!deploymentResponse.ok) throw new Error("本地合约尚未部署，请运行 npm run dev");
  const deployment = (await deploymentResponse.json()) as Deployment;
  const publicClient = createPublicClient({
    chain: hardhat,
    transport: http(deployment.rpcUrl),
  });
  let account: Address | undefined;
  let walletProvider: InjectedProvider | undefined;

  return {
    async loadStation() {
      const [operator, attestor, tariff, active] = await publicClient.readContract({
        address: deployment.contractAddress,
        abi,
        functionName: "getChargingStation",
        args: [keccak256(toBytes(deployment.stationId))],
      });
      return { id: deployment.stationId, operator, attestor, tariff, active };
    },

    async connectWallet() {
      walletProvider = await selectInjectedProvider();
      if (!walletProvider) throw new Error("请安装支持 EVM 的浏览器钱包");
      const walletClient = createWalletClient({ chain: hardhat, transport: custom(walletProvider) });
      try {
        [account] = await walletClient.requestAddresses();
        try {
          await walletProvider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x7a69" }],
          });
        } catch (switchReason) {
          const code = typeof switchReason === "object" && switchReason !== null && "code" in switchReason
            ? switchReason.code
            : undefined;
          if (code !== 4902) throw switchReason;
          await walletProvider.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x7a69",
              chainName: "ProofGrid Local",
              nativeCurrency: { name: "Test AVAX", symbol: "AVAX", decimals: 18 },
              rpcUrls: [deployment.rpcUrl],
            }],
          });
        }
        return account;
      } catch (reason) {
        throw friendlyError(reason);
      }
    },

    async createSession(request: CreateSessionRequest) {
      if (!walletProvider || !account) throw new Error("请先连接钱包");
      const walletClient = createWalletClient({ chain: hardhat, transport: custom(walletProvider) });
      try {
        const sessionId = keccak256(toBytes(request.sessionId));
        const hash = await walletClient.writeContract({
          account,
          address: deployment.contractAddress,
          abi,
          functionName: "createChargingSession",
          args: [
            sessionId,
            keccak256(toBytes(request.stationId)),
            request.maxEnergyWh,
            request.deadline,
          ],
          value: request.maximumPayment,
        });
        await publicClient.waitForTransactionReceipt({ hash });
        const session = await publicClient.readContract({
          address: deployment.contractAddress,
          abi,
          functionName: "getChargingSession",
          args: [sessionId],
        });
        if (session[8] !== 1) throw new Error("链上 Charging Session 未进入 Funded 状态");
        return {
          hash,
          state: "Funded",
          driver: session[0],
          sessionId: request.sessionId,
          stationId: request.stationId,
          operator: session[2],
          attestor: session[3],
          tariff: session[4],
          maxEnergyWh: session[5],
          maximumPayment: session[6],
          deadline: session[7],
        };
      } catch (reason) {
        throw friendlyError(reason);
      }
    },

    async settleSession(session: FundedSession) {
      if (!walletProvider || !account) throw new Error("请先连接钱包");
      const walletClient = createWalletClient({ chain: hardhat, transport: custom(walletProvider) });
      const sessionId = keccak256(toBytes(session.sessionId));
      try {
        const expiry = Math.floor(Date.now() / 1_000) + 30 * 60;
        const attestationResponse = await fetch(
          `${deployment.attestorUrl ?? "http://127.0.0.1:8080"}/attestations`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              sessionId,
              stationId: keccak256(toBytes(session.stationId)),
              chargingOperator: session.operator,
              meterStartWh: 120_000,
              meterEndWh: 138_400,
              expiry,
              chainId: deployment.chainId,
              verifyingContract: deployment.contractAddress,
            }),
          },
        );
        if (!attestationResponse.ok) throw new Error("无法生成 Charging Attestation");
        const signed = (await attestationResponse.json()) as AttestationResponse;
        const settlementHash = await walletClient.writeContract({
          account,
          address: deployment.contractAddress,
          abi,
          functionName: "settleChargingSession",
          args: [
            sessionId,
            BigInt(signed.actualEnergyWh),
            signed.evidenceHash,
            BigInt(signed.attestation.expiry),
            signed.signature,
          ],
        });
        await publicClient.waitForTransactionReceipt({ hash: settlementHash });
        const [chainSession, receipt] = await Promise.all([
          publicClient.readContract({
            address: deployment.contractAddress,
            abi,
            functionName: "getChargingSession",
            args: [sessionId],
          }),
          publicClient.readContract({
            address: deployment.contractAddress,
            abi,
            functionName: "getChargingReceipt",
            args: [sessionId],
          }),
        ]);
        if (chainSession[8] !== 2) throw new Error("链上 Charging Session 未进入 Settled 状态");
        return {
          ...session,
          state: "Settled" as const,
          settlementHash,
          rawChargingData: signed.rawChargingData,
          evidenceHash: receipt[8],
          actualEnergyWh: receipt[5],
          actualPayment: receipt[6],
          driverRefund: receipt[7],
          relayer: receipt[9],
          settledAt: receipt[10],
        };
      } catch (reason) {
        throw friendlyError(reason);
      }
    },
  };
}
