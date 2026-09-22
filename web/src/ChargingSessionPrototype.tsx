import { useEffect, useState } from "react";

// PROTOTYPE — three visual directions for the existing Charging Session page, switchable with ?prototype=A|B|C.
const variants = ["A", "B", "C"] as const;
type Variant = typeof variants[number];

const station = {
  id: "station-fuji-001",
  operator: "0x3C44…293BC",
  attestor: "0x90F7…3b906",
  tariff: "1,000 wei / Wh",
};

function usePrototypeVariant() {
  const read = (): Variant => {
    const value = new URLSearchParams(window.location.search).get("prototype")?.toUpperCase();
    return variants.includes(value as Variant) ? value as Variant : "A";
  };
  const [variant, setVariant] = useState<Variant>(read);
  const select = (next: Variant) => {
    const url = new URL(window.location.href);
    url.searchParams.set("prototype", next);
    window.history.replaceState({}, "", url);
    setVariant(next);
  };
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, [contenteditable=true]") || !["ArrowLeft", "ArrowRight"].includes(event.key)) return;
      event.preventDefault();
      const index = variants.indexOf(variant);
      select(variants[(index + (event.key === "ArrowRight" ? 1 : variants.length - 1)) % variants.length]);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [variant]);
  return { variant, select };
}

function WalletPill() {
  return <button className="prototype-wallet">◈ Connect wallet <span>⌄</span></button>;
}

function VariantA() {
  return <div className="prototype prototype-a">
    <nav><strong>PROOFGRID<span>/</span>CHARGE</strong><div><a>Protocol</a><a>Receipts</a><WalletPill /></div></nav>
    <header className="a-hero">
      <p className="eyebrow">Avalanche settlement rail · Fuji</p>
      <h1>Make charging<br /><em>verifiable.</em></h1>
      <p>Lock a charging budget. Settle only the energy delivered. Keep the receipt public.</p>
      <div className="a-stat-row"><b>01</b><span>Active station<br /><strong>{station.id}</strong></span><b>02</b><span>Escrow-backed<br /><strong>one-time settlement</strong></span></div>
    </header>
    <section className="a-console">
      <div className="a-console-title"><span>NEW CHARGING SESSION</span><small>NETWORK / AVALANCHE FUJI</small></div>
      <div className="a-console-grid">
        <label>Session reference<input placeholder="e.g. friday-commute-01" /></label>
        <label>Energy ceiling<input value="20,000 Wh" readOnly /></label>
        <label>Tariff<input value={station.tariff} readOnly /></label>
        <div className="a-payment"><span>MAXIMUM PAYMENT</span><strong>0.020000 AVAX</strong><small>20,000,000 wei</small></div>
      </div>
      <button className="a-primary">Authorize & fund <span>↗</span></button>
    </section>
  </div>;
}

function VariantB() {
  const steps = [["01", "Authorize", "Lock a maximum spend"], ["02", "Charge", "Attestor signs delivery"], ["03", "Settle", "Receipt becomes public"]];
  return <div className="prototype prototype-b">
    <aside><strong>pg<span>.</span></strong><p>ProofGrid<br />Charge</p><div className="b-chain">● Fuji testnet<br /><small>Chain ID 43113</small></div><footer>Built for real-world<br />machines ↗</footer></aside>
    <main>
      <nav><p>Driver workspace <span>/ New session</span></p><WalletPill /></nav>
      <header><p className="eyebrow">Step 01 of 03</p><h1>Authorize your<br />charging budget.</h1><p className="b-lede">Your money stays in a transparent escrow. The operator is paid only after a signed charging result is verified.</p></header>
      <div className="b-layout">
        <ol>{steps.map(([number, title, detail], index) => <li className={index === 0 ? "active" : ""} key={number}><b>{number}</b><div><strong>{title}</strong><span>{detail}</span></div></li>)}</ol>
        <section className="b-form"><div className="b-station"><span>CHARGING STATION</span><strong>{station.id}</strong><small>Operator {station.operator} · Attestor {station.attestor}</small></div><label>Charging Session ID<input placeholder="Name this authorization" /></label><label>Maximum authorized energy <output>20,000 Wh</output><input type="range" min="1000" max="40000" value="20000" readOnly /></label><div className="b-total"><span>Maximum payment</span><strong>0.020000 AVAX</strong><small>Fixed at {station.tariff}</small></div><button>Continue to wallet →</button></section>
      </div>
    </main>
  </div>;
}

function VariantC() {
  return <div className="prototype prototype-c">
    <header><strong>ProofGrid Charge</strong><span>◉ LIVE / FUJI</span><WalletPill /></header>
    <main>
      <section className="c-command"><p>ESCROW TERMINAL <span>v0.1</span></p><h1>Charge session<br /><i>authorization</i></h1><div className="c-command-line"><span>›</span><input placeholder="assign a session id" /><kbd>ENTER</kbd></div><small>Creates an on-chain commitment. No physical-charging claim is made here.</small></section>
      <section className="c-grid">
        <article className="c-station"><p>// VERIFIED STATION</p><h2>{station.id}</h2><dl><div><dt>operator</dt><dd>{station.operator}</dd></div><div><dt>attestor</dt><dd>{station.attestor}</dd></div><div><dt>tariff</dt><dd>{station.tariff}</dd></div><div><dt>status</dt><dd className="good">ACTIVE</dd></div></dl></article>
        <article className="c-receipt"><p>// SETTLEMENT PREVIEW</p><div><span>Max energy</span><strong>20,000 Wh</strong></div><div><span>Max payment</span><strong>0.020000 AVAX</strong></div><hr /><div><span>Attestation</span><strong>pending</strong></div><button>FUND SESSION ↗</button></article>
      </section>
      <p className="c-foot">ProofGrid proves a signed charging summary and one-time settlement rules — not the physical meter's truth.</p>
    </main>
  </div>;
}

export function ChargingSessionPrototype() {
  const { variant, select } = usePrototypeVariant();
  return <>
    {variant === "A" ? <VariantA /> : variant === "B" ? <VariantB /> : <VariantC />}
    <div className="prototype-switcher"><button onClick={() => select(variants[(variants.indexOf(variant) + variants.length - 1) % variants.length])}>←</button><span>{variant} — {variant === "A" ? "Immersive dashboard" : variant === "B" ? "Guided workflow" : "Protocol terminal"}</span><button onClick={() => select(variants[(variants.indexOf(variant) + 1) % variants.length])}>→</button></div>
  </>;
}
