export type FujiReleaseConfig = {
  rpcUrl: string;
  deployerPrivateKey: string;
  attestorPrivateKey: string;
  chargingOperator: string;
  attestorUrl: string;
  stationId: string;
  tariffWeiPerWh: bigint;
};

export type Environment = Record<string, string | undefined>;

export function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function privateKey(environment: Environment, name: string) {
  const value = required(environment, name);
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${name} must be a 32-byte hex private key`);
  return value;
}

function httpsUrl(environment: Environment, name: string) {
  const value = required(environment, name);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${name} must use https`);
  return parsed.toString().replace(/\/$/, "");
}

export function readFujiReleaseConfig(environment: Environment = process.env): FujiReleaseConfig {
  const tariff = environment.FUJI_TARIFF_WEI_PER_WH?.trim() ?? "1000";
  if (!/^\d+$/.test(tariff) || BigInt(tariff) === 0n) {
    throw new Error("FUJI_TARIFF_WEI_PER_WH must be a positive integer");
  }
  const chargingOperator = required(environment, "FUJI_CHARGING_OPERATOR_ADDRESS");
  if (!/^0x[0-9a-fA-F]{40}$/.test(chargingOperator)) {
    throw new Error("FUJI_CHARGING_OPERATOR_ADDRESS must be an EVM address");
  }

  return {
    rpcUrl: httpsUrl(environment, "FUJI_RPC_URL"),
    deployerPrivateKey: privateKey(environment, "FUJI_DEPLOYER_PRIVATE_KEY"),
    attestorPrivateKey: privateKey(environment, "PROOFGRID_ATTESTOR_PRIVATE_KEY"),
    chargingOperator,
    attestorUrl: httpsUrl(environment, "FUJI_ATTESTOR_URL"),
    stationId: environment.FUJI_STATION_ID?.trim() || "station-fuji-001",
    tariffWeiPerWh: BigInt(tariff),
  };
}
