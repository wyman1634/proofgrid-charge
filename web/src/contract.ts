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
import type { ChargeClient, CreateSessionRequest } from "./ChargingSessionPage";

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
] as const;

type Deployment = {
  contractAddress: Address;
  rpcUrl: string;
  stationId: string;
};

declare global {
  interface Window {
    ethereum?: EIP1193Provider;
  }
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

function friendlyError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
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
      if (!window.ethereum) throw new Error("请安装支持 EVM 的浏览器钱包");
      const walletClient = createWalletClient({ chain: hardhat, transport: custom(window.ethereum) });
      try {
        try {
          await window.ethereum.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: "0x7a69" }],
          });
        } catch (switchReason) {
          const code = typeof switchReason === "object" && switchReason !== null && "code" in switchReason
            ? switchReason.code
            : undefined;
          if (code !== 4902) throw switchReason;
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0x7a69",
              chainName: "ProofGrid Local",
              nativeCurrency: { name: "Test AVAX", symbol: "AVAX", decimals: 18 },
              rpcUrls: [deployment.rpcUrl],
            }],
          });
        }
        [account] = await walletClient.requestAddresses();
        return account;
      } catch (reason) {
        throw friendlyError(reason);
      }
    },

    async createSession(request: CreateSessionRequest) {
      if (!window.ethereum || !account) throw new Error("请先连接钱包");
      const walletClient = createWalletClient({ chain: hardhat, transport: custom(window.ethereum) });
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
  };
}
