const fields = ["chainId", "contractAddress", "rpcUrl", "attestorUrl", "stationId"] as const;

export type PublicFujiDeployment = {
  chainId: number;
  contractAddress: string;
  rpcUrl: string;
  attestorUrl: string;
  stationId: string;
};

function isPublicHttpsUrl(value: unknown) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      url.hostname !== "localhost" &&
      isIP(url.hostname.replace(/^\[|\]$/g, "")) === 0 &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "";
  } catch {
    return false;
  }
}

export function readPublicFujiDeployment(value: string): PublicFujiDeployment {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("FUJI_DEPLOYMENT_JSON must be valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("FUJI_DEPLOYMENT_JSON must be an object");
  }
  const record = parsed as Record<string, unknown>;
  if (Object.keys(record).length !== fields.length || Object.keys(record).some(key => !fields.includes(key as typeof fields[number]))) {
    throw new Error("FUJI_DEPLOYMENT_JSON must not contain unknown or secret fields");
  }
  if (record.chainId !== 43_113) throw new Error("FUJI_DEPLOYMENT_JSON chainId must be 43113");
  if (typeof record.contractAddress !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(record.contractAddress)) {
    throw new Error("FUJI_DEPLOYMENT_JSON contractAddress must be an EVM address");
  }
  if (!isPublicHttpsUrl(record.rpcUrl) || !isPublicHttpsUrl(record.attestorUrl)) {
    throw new Error("FUJI_DEPLOYMENT_JSON URLs must use a public HTTPS hostname without credentials, query parameters, or fragments");
  }
  if (typeof record.stationId !== "string" || !/^[a-zA-Z0-9-]{3,64}$/.test(record.stationId)) {
    throw new Error("FUJI_DEPLOYMENT_JSON stationId must contain only letters, numbers, and hyphens");
  }
  return record as PublicFujiDeployment;
}
import { isIP } from "node:net";
