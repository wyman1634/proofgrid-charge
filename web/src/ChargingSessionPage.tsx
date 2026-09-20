import { useEffect, useMemo, useState } from "react";

export type ChargingStation = {
  id: string;
  operator: string;
  attestor: string;
  tariff: bigint;
  active: boolean;
};

export type CreateSessionRequest = {
  sessionId: string;
  stationId: string;
  maxEnergyWh: bigint;
  deadline: bigint;
  maximumPayment: bigint;
};

export type FundedSession = CreateSessionRequest & {
  hash: string;
  state: "Funded";
  driver: string;
  operator: string;
  attestor: string;
  tariff: bigint;
};

export type SettledSession = Omit<FundedSession, "state"> & {
  state: "Settled";
  settlementHash: string;
  rawChargingData: string;
  evidenceHash: string;
  actualEnergyWh: bigint;
  actualPayment: bigint;
  driverRefund: bigint;
  relayer: string;
  settledAt: bigint;
};

export interface ChargeClient {
  loadStation(): Promise<ChargingStation>;
  connectWallet(): Promise<string>;
  createSession(request: CreateSessionRequest): Promise<FundedSession>;
  settleSession(session: FundedSession): Promise<SettledSession>;
}

type Props = {
  client: ChargeClient;
  now?: () => Date;
};

export function ChargingSessionPage({ client, now = () => new Date() }: Props) {
  const [station, setStation] = useState<ChargingStation>();
  const [wallet, setWallet] = useState<string>();
  const [sessionId, setSessionId] = useState("");
  const [maxEnergyWh, setMaxEnergyWh] = useState("20000");
  const [deadline, setDeadline] = useState(() =>
    new Date(now().getTime() + 60 * 60 * 1_000).toISOString().slice(0, 16),
  );
  const [result, setResult] = useState<FundedSession | SettledSession>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [settling, setSettling] = useState(false);

  useEffect(() => {
    client.loadStation().then(setStation).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "无法加载 Charging Station");
    });
  }, [client]);

  const maximumPayment = useMemo(() => {
    if (!station || !/^\d+$/.test(maxEnergyWh)) return 0n;
    return station.tariff * BigInt(maxEnergyWh);
  }, [maxEnergyWh, station]);

  async function connect() {
    setError(undefined);
    try {
      setWallet(await client.connectWallet());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "钱包连接失败");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!station || !wallet) return;
    setSubmitting(true);
    setError(undefined);
    try {
      setResult(
        await client.createSession({
          sessionId,
          stationId: station.id,
          maxEnergyWh: BigInt(maxEnergyWh),
          deadline: BigInt(Math.floor(new Date(deadline).getTime() / 1_000)),
          maximumPayment,
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "创建 Charging Session 失败");
    } finally {
      setSubmitting(false);
    }
  }

  async function settle() {
    if (!result || result.state !== "Funded") return;
    setSettling(true);
    setError(undefined);
    try {
      setResult(await client.settleSession(result));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Settlement 失败");
    } finally {
      setSettling(false);
    }
  }

  if (!station) {
    return <main>{error ? <p role="alert">{error}</p> : <p>正在加载 Charging Station…</p>}</main>;
  }

  return (
    <main>
      <header>
        <p>ProofGrid Charge</p>
        <h1>创建并出资 Charging Session</h1>
      </header>

      <section aria-labelledby="station-heading">
        <h2 id="station-heading">Charging Station</h2>
        <dl>
          <div><dt>Station</dt><dd>{station.id}</dd></div>
          <div><dt>Charging Operator</dt><dd>{station.operator}</dd></div>
          <div><dt>Attestor</dt><dd>{station.attestor}</dd></div>
          <div><dt>Tariff</dt><dd>{station.tariff.toLocaleString("en-US")} wei / Wh</dd></div>
          <div><dt>状态</dt><dd>{station.active ? "Active" : "Inactive"}</dd></div>
        </dl>
      </section>

      <form onSubmit={submit}>
        <label>
          Charging Session ID
          <input required value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
        </label>
        <label>
          最大授权电量 (Wh)
          <input
            type="number"
            min="1"
            required
            value={maxEnergyWh}
            onChange={(event) => setMaxEnergyWh(event.target.value)}
          />
        </label>
        <label>
          截止时间
          <input
            type="datetime-local"
            required
            value={deadline}
            onChange={(event) => setDeadline(event.target.value)}
          />
        </label>
        <p>Maximum Payment <strong>{maximumPayment.toLocaleString("en-US")} wei</strong></p>
        {!wallet ? (
          <button type="button" onClick={connect}>连接钱包</button>
        ) : (
          <>
            <p>Driver {wallet}</p>
            <button type="submit" disabled={submitting || !station.active}>
              {submitting ? "提交中…" : "准确出资并创建"}
            </button>
          </>
        )}
      </form>

      {error && <p role="alert">{error}</p>}
      {result && (
        <section aria-label="Charging Session 结果">
          <h2>{result.state}</h2>
          <p>交易标识 <code>{result.state === "Settled" ? result.settlementHash : result.hash}</code></p>
          <h3>链上锁定条款</h3>
          <dl>
            <div><dt>Session</dt><dd>{result.sessionId}</dd></div>
            <div><dt>Driver</dt><dd>{result.driver}</dd></div>
            <div><dt>Station</dt><dd>{result.stationId}</dd></div>
            <div><dt>Charging Operator</dt><dd>{result.operator}</dd></div>
            <div><dt>Attestor</dt><dd>{result.attestor}</dd></div>
            <div><dt>Tariff</dt><dd>{result.tariff.toLocaleString("en-US")} wei / Wh</dd></div>
            <div><dt>最大授权电量</dt><dd>{result.maxEnergyWh.toLocaleString("en-US")} Wh</dd></div>
            <div><dt>Maximum Payment</dt><dd>{result.maximumPayment.toLocaleString("en-US")} wei</dd></div>
            <div><dt>截止时间</dt><dd>{new Date(Number(result.deadline) * 1_000).toLocaleString()}</dd></div>
          </dl>
          {result.state === "Funded" ? (
            <button type="button" disabled={settling} onClick={settle}>
              {settling ? "结算中…" : "模拟并结算"}
            </button>
          ) : (
            <>
              <h3>Charging Receipt</h3>
              <dl>
                <div><dt>Actual Energy</dt><dd>{result.actualEnergyWh.toLocaleString("en-US")} Wh</dd></div>
                <div><dt>Operator Payment</dt><dd>{result.actualPayment.toLocaleString("en-US")} wei</dd></div>
                <div><dt>Driver Refund</dt><dd>{result.driverRefund.toLocaleString("en-US")} wei</dd></div>
                <div><dt>Evidence Hash</dt><dd><code>{result.evidenceHash}</code></dd></div>
                <div><dt>Relayer</dt><dd>{result.relayer}</dd></div>
                <div><dt>Settled At</dt><dd>{new Date(Number(result.settledAt) * 1_000).toLocaleString()}</dd></div>
              </dl>
              <details>
                <summary>规范化原始充电记录</summary>
                <pre>{result.rawChargingData}</pre>
              </details>
            </>
          )}
        </section>
      )}
    </main>
  );
}
