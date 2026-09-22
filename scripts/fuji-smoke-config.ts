import { readFujiReleaseConfig, required, type Environment, type FujiReleaseConfig } from "./release-config";

export type FujiSmokeConfig = FujiReleaseConfig & {
  contractAddress: string;
  sessionName: string;
};

export function readFujiSmokeConfig(environment: Environment = process.env): FujiSmokeConfig {
  const contractAddress = required(environment, "FUJI_CONTRACT_ADDRESS");
  if (!/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) {
    throw new Error("FUJI_CONTRACT_ADDRESS must be an EVM address");
  }
  const sessionName = environment.FUJI_SMOKE_SESSION_ID?.trim() || `fuji-smoke-${Date.now()}`;
  if (!/^[a-zA-Z0-9-]{3,64}$/.test(sessionName)) {
    throw new Error("FUJI_SMOKE_SESSION_ID must contain only letters, numbers, and hyphens");
  }
  return {
    ...readFujiReleaseConfig(environment),
    contractAddress,
    sessionName,
  };
}
