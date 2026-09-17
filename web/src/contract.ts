import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  keccak256,
  toBytes,
  type Address,
  type EIP1193Provider,
} from "viem";
import { hardhat } from "viem/chains";
import type { ChargeClient, CreateSessionRequest } from "./ChargingSessionPage";

const abi = [
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

function friendlyError(reason: unknown) {
  const message = reason instanceof Error ? reason.message : String(reason);
  const knownErrors: Array<[string, string]> = [
    ["DuplicateChargingSession", "该 Charging Session ID 已存在"],
    ["InactiveChargingStation", "该 Charging Station 当前不可用"],
    ["IncorrectFunding", "出资金额必须准确等于 Maximum Payment"],
    ["InvalidDeadline", "截止时间必须晚于当前时间"],
    ["User rejected", "Driver 已取消钱包请求"],
  ];
  return new Error(knownErrors.find(([name]) => message.includes(name))?.[1] ?? message);
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
        return { hash, state: "Funded" };
      } catch (reason) {
        throw friendlyError(reason);
      }
    },
  };
}
