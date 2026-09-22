import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ChargingSessionPage, type ChargeClient } from "./ChargingSessionPage";

const station = {
  id: "station-fuji-001",
  operator: "0x1111111111111111111111111111111111111111",
  attestor: "0x2222222222222222222222222222222222222222",
  tariff: 1_000n,
  active: true,
};

const fundedSession = {
  hash: "0xabc123",
  state: "Funded" as const,
  driver: "0x3333333333333333333333333333333333333333",
  sessionId: "session-001",
  stationId: station.id,
  operator: station.operator,
  attestor: station.attestor,
  tariff: station.tariff,
  maxEnergyWh: 20_000n,
  maximumPayment: 20_000_000n,
  deadline: 1_789_635_600n,
};

const settledSession = {
  ...fundedSession,
  state: "Settled" as const,
  settlementHash: "0xsettled123",
  rawChargingData: "{\"meterStartWh\":120000,\"meterEndWh\":138400}",
  evidenceHash: "0xevidence123",
  actualEnergyWh: 18_400n,
  actualPayment: 18_400_000n,
  driverRefund: 1_600_000n,
  relayer: "0x4444444444444444444444444444444444444444",
  settledAt: 1_789_632_000n,
  evidenceHashMatches: true,
};

const refundedSession = {
  ...fundedSession,
  state: "Refunded" as const,
  refundHash: "0xrefund123",
};

const beforeDeadline = async () => 1_000n;
const afterDeadline = async () => 1_800_000_000n;

describe("Charging Session product interface", () => {
  it("shows locked terms before the Driver funds the Session", async () => {
    const client: ChargeClient = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => fundedSession,
      settleSession: async () => settledSession,
      timeoutRefund: async () => refundedSession,
      getChainTimestamp: beforeDeadline,
    };

    render(<ChargingSessionPage client={client} now={() => new Date("2026-09-17T09:00:00Z")} />);

    expect(await screen.findByText("station-fuji-001")).toBeVisible();
    expect(screen.getByText(station.operator)).toBeVisible();
    expect(screen.getByText(station.attestor)).toBeVisible();
    expect(screen.getByText("1,000 wei / Wh")).toBeVisible();
    expect(screen.getByLabelText("最大授权电量 (Wh)")).toHaveValue(20_000);
    expect(screen.getByText("20,000,000 wei")).toBeVisible();
    expect(screen.getByLabelText("截止时间")).toHaveValue("2026-09-17T18:00");
  });

  it("submits a default deadline one hour after the Driver's current time", async () => {
    const user = userEvent.setup();
    let submittedDeadline: bigint | undefined;
    const client: ChargeClient = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async (request) => {
        submittedDeadline = request.deadline;
        return fundedSession;
      },
      settleSession: async () => settledSession,
      timeoutRefund: async () => refundedSession,
      getChainTimestamp: beforeDeadline,
    };

    render(<ChargingSessionPage client={client} now={() => new Date("2026-09-17T09:00:00Z")} />);

    await screen.findByText("station-fuji-001");
    await user.click(screen.getByRole("button", { name: "连接钱包" }));
    await user.type(screen.getByLabelText("Charging Session ID"), "future-deadline");
    await user.click(screen.getByRole("button", { name: "准确出资并创建" }));

    expect(submittedDeadline).toBe(1_789_639_200n);
  });

  it("shows the Funded state and transaction after exact funding succeeds", async () => {
    const user = userEvent.setup();
    const client: ChargeClient = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => fundedSession,
      settleSession: async () => settledSession,
      timeoutRefund: async () => refundedSession,
      getChainTimestamp: beforeDeadline,
    };
    render(<ChargingSessionPage client={client} now={() => new Date("2026-09-17T09:00:00Z")} />);

    await screen.findByText("station-fuji-001");
    await user.click(screen.getByRole("button", { name: "连接钱包" }));
    await user.type(screen.getByLabelText("Charging Session ID"), "session-001");
    await user.click(screen.getByRole("button", { name: "准确出资并创建" }));

    expect(await screen.findByText("Funded")).toBeVisible();
    expect(screen.getByText("0xabc123")).toBeVisible();
    const resultRegion = screen.getByRole("region", { name: "Charging Session 结果" });
    expect(within(resultRegion).getByText("20,000 Wh")).toBeVisible();
    expect(within(resultRegion).getByText("session-001")).toBeVisible();
    expect(within(resultRegion).getByText(station.operator)).toBeVisible();
    expect(within(resultRegion).getByText(station.attestor)).toBeVisible();
    expect(within(resultRegion).getByText("20,000,000 wei")).toBeVisible();
  });

  it("shows a clear reason when funding is rejected", async () => {
    const user = userEvent.setup();
    const client: ChargeClient = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => {
        throw new Error("该 Charging Session ID 已存在");
      },
      settleSession: async () => settledSession,
      timeoutRefund: async () => refundedSession,
      getChainTimestamp: beforeDeadline,
    };
    render(<ChargingSessionPage client={client} now={() => new Date("2026-09-17T09:00:00Z")} />);

    await screen.findByText("station-fuji-001");
    await user.click(screen.getByRole("button", { name: "连接钱包" }));
    await user.type(screen.getByLabelText("Charging Session ID"), "duplicate");
    await user.click(screen.getByRole("button", { name: "准确出资并创建" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("该 Charging Session ID 已存在");
  });

  it("shows the Settled result after simulating and submitting a Charging Attestation", async () => {
    const user = userEvent.setup();
    const client = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => fundedSession,
      settleSession: async () => settledSession,
      timeoutRefund: async () => refundedSession,
      getChainTimestamp: beforeDeadline,
    };
    render(<ChargingSessionPage client={client} now={() => new Date("2026-09-17T09:00:00Z")} />);

    await screen.findByText("station-fuji-001");
    await user.click(screen.getByRole("button", { name: "连接钱包" }));
    await user.type(screen.getByLabelText("Charging Session ID"), "session-001");
    await user.click(screen.getByRole("button", { name: "准确出资并创建" }));
    await screen.findByText("Funded");
    await user.click(screen.getByRole("button", { name: "模拟并结算" }));

    const resultRegion = await screen.findByRole("region", { name: "Charging Session 结果" });
    expect(within(resultRegion).getByRole("heading", { name: "Settled" })).toBeVisible();
    expect(within(resultRegion).getByText("18,400 Wh")).toBeVisible();
    expect(within(resultRegion).getByText("18,400,000 wei")).toBeVisible();
    expect(within(resultRegion).getByText("1,600,000 wei")).toBeVisible();
    expect(within(resultRegion).getByText("0xevidence123")).toBeVisible();
    expect(within(resultRegion).getByText("0x4444444444444444444444444444444444444444")).toBeVisible();
    expect(within(resultRegion).getByText("0xsettled123")).toBeVisible();
  });

  it("lets the Driver request a Timeout Refund after the on-chain deadline", async () => {
    const user = userEvent.setup();
    let refunded = false;
    const client = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => fundedSession,
      settleSession: async () => settledSession,
      timeoutRefund: async () => {
        refunded = true;
        return { ...fundedSession, state: "Refunded" as const, refundHash: "0xrefund123" };
      },
      getChainTimestamp: afterDeadline,
    };
    render(<ChargingSessionPage client={client} now={() => new Date("2027-01-01T00:00:00Z")} />);

    await screen.findByText("station-fuji-001");
    await user.click(screen.getByRole("button", { name: "连接钱包" }));
    await user.type(screen.getByLabelText("Charging Session ID"), "session-001");
    await user.click(screen.getByRole("button", { name: "准确出资并创建" }));
    await user.click(await screen.findByRole("button", { name: "发起 Timeout Refund" }));

    expect(refunded).toBe(true);
    expect(await screen.findByRole("heading", { name: "Refunded" })).toBeVisible();
    expect(screen.getByText("0xrefund123")).toBeVisible();
    expect(screen.queryByText("Charging Receipt")).not.toBeInTheDocument();
  });

  it("restores a Refunded Charging Session from its public Session ID without a wallet", async () => {
    const user = userEvent.setup();
    const client: ChargeClient = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => fundedSession,
      settleSession: async () => settledSession,
      timeoutRefund: async () => refundedSession,
      getChainTimestamp: beforeDeadline,
      lookupSession: async (sessionId) => sessionId === "refunded-session" ? refundedSession : undefined,
    };
    render(<ChargingSessionPage client={client} />);

    await screen.findByText("station-fuji-001");
    await user.type(screen.getByLabelText("Charging Session ID"), "refunded-session");
    await user.click(screen.getByRole("button", { name: "查询链上状态" }));

    expect(await screen.findByRole("heading", { name: "Refunded" })).toBeVisible();
    expect(screen.getByText("全部 Maximum Payment 已退回 Driver；该 Charging Session 未生成 Charging Receipt。")).toBeVisible();
  });

  it("distinguishes the current Charging Station configuration from a queried Session's locked terms", async () => {
    const user = userEvent.setup();
    const currentStation = {
      ...station,
      operator: "0x5555555555555555555555555555555555555555",
      attestor: "0x6666666666666666666666666666666666666666",
      tariff: 2_000n,
    };
    const lockedSession = {
      ...fundedSession,
      operator: station.operator,
      attestor: station.attestor,
      tariff: station.tariff,
    };
    const client: ChargeClient = {
      loadStation: async () => currentStation,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => lockedSession,
      settleSession: async () => settledSession,
      timeoutRefund: async () => refundedSession,
      getChainTimestamp: beforeDeadline,
      lookupSession: async () => lockedSession,
    };
    render(<ChargingSessionPage client={client} />);

    await screen.findByText("2,000 wei / Wh");
    await user.type(screen.getByLabelText("Charging Session ID"), "original-station-terms");
    await user.click(screen.getByRole("button", { name: "查询链上状态" }));

    const resultRegion = await screen.findByRole("region", { name: "Charging Session 结果" });
    expect(screen.getByText(currentStation.operator)).toBeVisible();
    expect(screen.getByText(currentStation.attestor)).toBeVisible();
    expect(within(resultRegion).getByText(station.operator)).toBeVisible();
    expect(within(resultRegion).getByText(station.attestor)).toBeVisible();
    expect(within(resultRegion).getByText("1,000 wei / Wh")).toBeVisible();
  });

  it("lets a visitor verify a public Charging Receipt without connecting a wallet", async () => {
    const user = userEvent.setup();
    const client: ChargeClient = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => fundedSession,
      settleSession: async () => settledSession,
      timeoutRefund: async () => refundedSession,
      getChainTimestamp: beforeDeadline,
      lookupSession: async () => settledSession,
    };
    render(<ChargingSessionPage client={client} />);

    await screen.findByText("station-fuji-001");
    await user.type(screen.getByLabelText("Charging Session ID"), "settled-session");
    await user.click(screen.getByRole("button", { name: "查询链上状态" }));

    expect(await screen.findByRole("heading", { name: "Settled" })).toBeVisible();
    expect(screen.getByText("Charging Receipt")).toBeVisible();
    expect(screen.getByText("0xevidence123")).toBeVisible();
    expect(screen.getByText("与 Charging Receipt 一致")).toBeVisible();
  });

  it("keeps the Charging Session Funded and explains a rejected tampered Attestation", async () => {
    const user = userEvent.setup();
    const settleSession = async (_session: typeof fundedSession, scenario?: string) => {
      expect(scenario).toBe("tamperedActualEnergy");
      throw new Error("Charging Attestation 无效或已被篡改");
    };
    const client: ChargeClient = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => fundedSession,
      settleSession,
      timeoutRefund: async () => refundedSession,
      getChainTimestamp: beforeDeadline,
    };
    render(<ChargingSessionPage client={client} now={() => new Date("2026-09-17T09:00:00Z")} />);

    await screen.findByText("station-fuji-001");
    await user.click(screen.getByRole("button", { name: "连接钱包" }));
    await user.type(screen.getByLabelText("Charging Session ID"), "session-001");
    await user.click(screen.getByRole("button", { name: "准确出资并创建" }));
    await screen.findByText("Funded");
    await user.selectOptions(screen.getByLabelText("结算场景"), "tamperedActualEnergy");
    await user.click(screen.getByRole("button", { name: "模拟并结算" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Charging Attestation 无效或已被篡改");
    expect(screen.getByRole("heading", { name: "Funded" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Settled" })).not.toBeInTheDocument();
  });
});
