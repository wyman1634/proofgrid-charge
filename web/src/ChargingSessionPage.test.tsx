import { render, screen } from "@testing-library/react";
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

describe("Charging Session product interface", () => {
  it("shows locked terms before the Driver funds the Session", async () => {
    const client: ChargeClient = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => ({ hash: "0xabc", state: "Funded" }),
    };

    render(<ChargingSessionPage client={client} now={() => new Date("2026-09-17T09:00:00Z")} />);

    expect(await screen.findByText("station-fuji-001")).toBeVisible();
    expect(screen.getByText(station.operator)).toBeVisible();
    expect(screen.getByText(station.attestor)).toBeVisible();
    expect(screen.getByText("1,000 wei / Wh")).toBeVisible();
    expect(screen.getByLabelText("最大授权电量 (Wh)")).toHaveValue(20_000);
    expect(screen.getByText("20,000,000 wei")).toBeVisible();
    expect(screen.getByLabelText("截止时间")).toHaveValue("2026-09-17T10:00");
  });

  it("shows the Funded state and transaction after exact funding succeeds", async () => {
    const user = userEvent.setup();
    const client: ChargeClient = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => ({ hash: "0xabc123", state: "Funded" }),
    };
    render(<ChargingSessionPage client={client} now={() => new Date("2026-09-17T09:00:00Z")} />);

    await screen.findByText("station-fuji-001");
    await user.click(screen.getByRole("button", { name: "连接钱包" }));
    await user.type(screen.getByLabelText("Charging Session ID"), "session-001");
    await user.click(screen.getByRole("button", { name: "准确出资并创建" }));

    expect(await screen.findByText("Funded")).toBeVisible();
    expect(screen.getByText("0xabc123")).toBeVisible();
  });

  it("shows a clear reason when funding is rejected", async () => {
    const user = userEvent.setup();
    const client: ChargeClient = {
      loadStation: async () => station,
      connectWallet: async () => "0x3333333333333333333333333333333333333333",
      createSession: async () => {
        throw new Error("该 Charging Session ID 已存在");
      },
    };
    render(<ChargingSessionPage client={client} now={() => new Date("2026-09-17T09:00:00Z")} />);

    await screen.findByText("station-fuji-001");
    await user.click(screen.getByRole("button", { name: "连接钱包" }));
    await user.type(screen.getByLabelText("Charging Session ID"), "duplicate");
    await user.click(screen.getByRole("button", { name: "准确出资并创建" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("该 Charging Session ID 已存在");
  });
});
