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
  evidenceHashMatches?: boolean;
  transactionUrl?: string;
};

export type RefundedSession = Omit<FundedSession, "state"> & {
  state: "Refunded";
  refundHash: string;
  transactionUrl?: string;
};

export type SettlementScenario =
  | "valid"
  | "tamperedActualEnergy"
  | "tamperedEvidenceHash"
  | "expiredAttestation";

export interface ChargeClient {
  loadStation(): Promise<ChargingStation>;
  connectWallet(): Promise<string>;
  createSession(request: CreateSessionRequest): Promise<FundedSession>;
  settleSession(session: FundedSession, scenario?: SettlementScenario): Promise<SettledSession>;
  timeoutRefund(session: FundedSession): Promise<RefundedSession>;
  getChainTimestamp(): Promise<bigint>;
  lookupSession?(sessionId: string): Promise<FundedSession | SettledSession | RefundedSession | undefined>;
}

type Props = {
  client: ChargeClient;
  now?: () => Date;
};

function formatLocalDateTime(date: Date) {
  const pad = (value: number) => value.toString().padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    + `T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function ChargingSessionPage({ client, now = () => new Date() }: Props) {
  const [station, setStation] = useState<ChargingStation>();
  const [wallet, setWallet] = useState<string>();
  const [sessionId, setSessionId] = useState("");
  const [maxEnergyWh, setMaxEnergyWh] = useState("20000");
  const [deadline, setDeadline] = useState(() =>
    formatLocalDateTime(new Date(now().getTime() + 60 * 60 * 1_000)),
  );
  const [result, setResult] = useState<FundedSession | SettledSession | RefundedSession>();
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);
  const [settling, setSettling] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const [chainTimestamp, setChainTimestamp] = useState<bigint>();
  const [settlementScenario, setSettlementScenario] = useState<SettlementScenario>("valid");

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
      setResult(await client.settleSession(result, settlementScenario));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Settlement 失败");
    } finally {
      setSettling(false);
    }
  }

  async function refund() {
    if (!result || result.state !== "Funded") return;
    setRefunding(true);
    setError(undefined);
    try {
      setResult(await client.timeoutRefund(result));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Timeout Refund 失败");
    } finally {
      setRefunding(false);
    }
  }

  async function lookup() {
    setError(undefined);
    try {
      if (!client.lookupSession) throw new Error("当前客户端不支持链上状态查询");
      const session = await client.lookupSession(sessionId);
      if (!session) throw new Error("未找到该 Charging Session");
      setResult(session);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "无法查询 Charging Session");
    }
  }

  useEffect(() => {
    if (result?.state !== "Funded") return;
    let active = true;
    const refreshChainTimestamp = () => {
      client.getChainTimestamp().then((timestamp) => {
        if (active) setChainTimestamp(timestamp);
      }).catch(() => {
        if (active) setChainTimestamp(undefined);
      });
    };
    refreshChainTimestamp();
    const interval = window.setInterval(refreshChainTimestamp, 15_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [client, result]);

  const refundAvailable = chainTimestamp !== undefined && chainTimestamp > (result?.deadline ?? 0n);

  if (!station) {
    return <main className="loading-screen">{error ? <p role="alert">{error}</p> : <p>正在加载 Charging Station…</p>}</main>;
  }

  return (
    <main className="app-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="ProofGrid Charge 首页">
          <span className="brand-mark">P</span>
          <span>ProofGrid <em>Charge</em></span>
        </a>
        <p className="network-status"><span /> Avalanche Fuji · 43113</p>
      </header>

      <div className="experience-grid" id="top">
        <aside className="flow-rail" aria-label="Charging Session 流程">
          <p className="rail-eyebrow">Guided transaction</p>
          <h2>把一次充电，变成可核验的结算。</h2>
          <ol className="flow-steps">
            <li className={!result ? "is-active" : "is-complete"}><span>01</span><div><strong>Authorize</strong><small>锁定 Maximum Payment</small></div></li>
            <li className={result?.state === "Funded" ? "is-active" : result ? "is-complete" : ""}><span>02</span><div><strong>Charge</strong><small>Attestor 签发数据</small></div></li>
            <li className={result?.state === "Settled" ? "is-active is-complete" : ""}><span>03</span><div><strong>Settle</strong><small>生成公开 Receipt</small></div></li>
          </ol>
          <div className="rail-note"><span>↗</span><p>付款上限、费率和截止时间会在链上锁定，结算只按 Charging Receipt 执行。</p></div>
        </aside>

        <div className="workspace">
          <header className="hero">
            <p className="eyebrow">Proof of charge · on Avalanche</p>
            <h1>创建并出资 <span>Charging Session</span></h1>
            <p>先明确你愿意承担的最大费用；充电完成后，由可验证的 Attestation 触发结算。</p>
          </header>

          <section className="station-card" aria-labelledby="station-heading">
            <div className="section-heading"><div><p className="eyebrow">Destination</p><h2 id="station-heading">Charging Station</h2></div><span className={`status-pill ${station.active ? "is-active" : ""}`}>{station.active ? "● Active" : "● Inactive"}</span></div>
            <dl>
              <div><dt>Station</dt><dd>{station.id}</dd></div>
              <div><dt>Charging Operator</dt><dd>{station.operator}</dd></div>
              <div><dt>Attestor</dt><dd>{station.attestor}</dd></div>
              <div><dt>Tariff</dt><dd>{station.tariff.toLocaleString("en-US")} wei / Wh</dd></div>
              <div><dt>状态</dt><dd>{station.active ? "Active" : "Inactive"}</dd></div>
            </dl>
          </section>

          <section className="funding-card" aria-labelledby="funding-heading">
            <div className="section-heading"><div><p className="eyebrow">Step 01</p><h2 id="funding-heading">设定授权上限</h2></div><p className="secure-label">⟡ Contract enforced</p></div>
            <form onSubmit={submit}>
              <div className="form-grid">
                <label className="field-wide">
                  Charging Session ID
                  <input required placeholder="例如：fuji-session-001" value={sessionId} onChange={(event) => setSessionId(event.target.value)} />
                </label>
                <label>
                  最大授权电量 (Wh)
                  <input type="number" min="1" required value={maxEnergyWh} onChange={(event) => setMaxEnergyWh(event.target.value)} />
                </label>
                <label>
                  截止时间
                  <input type="datetime-local" required value={deadline} onChange={(event) => setDeadline(event.target.value)} />
                </label>
              </div>
              <div className="payment-summary"><span>Maximum Payment</span><strong>{maximumPayment.toLocaleString("en-US")} wei</strong><span className="payment-lock">锁定上限</span></div>
              {!wallet ? (
                <button className="primary-action" type="button" onClick={connect}>连接钱包 <span aria-hidden="true">→</span></button>
              ) : (
                <div className="wallet-action"><p>Driver <code>{wallet}</code></p><button className="primary-action" type="submit" disabled={submitting || !station.active}>{submitting ? "提交中…" : <>准确出资并创建 <span aria-hidden="true">→</span></>}</button></div>
              )}
            </form>
          </section>

          <section className="lookup-card" aria-labelledby="lookup-heading">
            <div>
              <p className="eyebrow">Existing session</p>
              <h2 id="lookup-heading">已有 Charging Session？</h2>
              <p>输入已有的 Session ID 后，读取链上锁定条款、结算状态和公开 Charging Receipt。</p>
            </div>
            <button className="lookup-button" type="button" onClick={lookup} disabled={!sessionId}>查询链上状态 <span aria-hidden="true">↗</span></button>
          </section>

          {error && <p role="alert">{error}</p>}
          {result && (
        <section className="result-card" aria-label="Charging Session 结果">
          <div className="result-heading"><div><p className="eyebrow">On-chain outcome</p><h2>{result.state}</h2></div><span className={`status-pill ${result.state === "Funded" || result.state === "Settled" ? "is-active" : ""}`}>● {result.state}</span></div>
          {result.state === "Settled" && <p className="receipt-confirmation">✓ 链上回执已确认</p>}
          <p className="transaction-line">
            {result.state === "Settled" ? "Settlement 交易哈希" : result.state === "Refunded" ? "Timeout Refund 交易哈希" : "创建交易哈希"}
            {" "}{result.state !== "Funded" && result.transactionUrl ? (
              <a href={result.transactionUrl} target="_blank" rel="noreferrer">查看交易</a>
            ) : <code>{result.state === "Settled" ? result.settlementHash : result.state === "Refunded" ? result.refundHash : result.hash}</code>}
          </p>
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
            <>
              <label>
                结算场景
                <select
                  value={settlementScenario}
                  onChange={(event) => setSettlementScenario(event.target.value as SettlementScenario)}
                >
                  <option value="valid">正常 Charging Attestation</option>
                  <option value="tamperedActualEnergy">篡改 Actual Energy</option>
                  <option value="tamperedEvidenceHash">篡改 Evidence Hash</option>
                  <option value="expiredAttestation">过期 Charging Attestation</option>
                </select>
              </label>
              <button className="primary-action" type="button" disabled={settling} onClick={settle}>
                {settling ? "结算中…" : "模拟并结算"}
              </button>
              {refundAvailable ? (
                <button className="refund-button" type="button" disabled={refunding} onClick={refund}>
                  {refunding ? "退款中…" : "发起 Timeout Refund"}
                </button>
              ) : (
                <p>Timeout Refund 将在截止时间后可用。</p>
              )}
            </>
          ) : result.state === "Settled" ? (
            <>
              <h3>Charging Receipt</h3>
              <dl>
                <div><dt>Actual Energy</dt><dd>{result.actualEnergyWh.toLocaleString("en-US")} Wh</dd></div>
                <div><dt>Operator Payment</dt><dd>{result.actualPayment.toLocaleString("en-US")} wei</dd></div>
                <div><dt>Driver Refund</dt><dd>{result.driverRefund.toLocaleString("en-US")} wei</dd></div>
                <div><dt>Evidence Hash</dt><dd><code>{result.evidenceHash}</code></dd></div>
                {result.evidenceHashMatches !== undefined && (
                  <div><dt>Evidence Hash 复算</dt><dd>{result.evidenceHashMatches ? "与 Charging Receipt 一致" : "与 Charging Receipt 不一致"}</dd></div>
                )}
                <div><dt>Relayer</dt><dd>{result.relayer}</dd></div>
                <div><dt>Settled At</dt><dd>{new Date(Number(result.settledAt) * 1_000).toLocaleString()}</dd></div>
              </dl>
              <details>
                <summary>规范化原始充电记录</summary>
                <pre>{result.rawChargingData}</pre>
              </details>
              <p>链上证明 Attestor 签过该摘要且 Settlement 按锁定规则执行；不证明物理电表或 Attestor 绝对诚实。</p>
            </>
          ) : (
            <p>全部 Maximum Payment 已退回 Driver；该 Charging Session 未生成 Charging Receipt。</p>
          )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
