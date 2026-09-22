import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ChargingSessionPage } from "./ChargingSessionPage";
import { ChargingSessionPrototype } from "./ChargingSessionPrototype";
import { createBrowserChargeClient } from "./contract";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
const prototype = process.env.NODE_ENV !== "production" && new URLSearchParams(window.location.search).has("prototype");

if (prototype) {
  root.render(<ChargingSessionPrototype />);
} else createBrowserChargeClient()
  .then((client) => {
    root.render(
      <StrictMode>
        <ChargingSessionPage client={client} />
      </StrictMode>,
    );
  })
  .catch((reason: unknown) => {
    root.render(<p role="alert">{reason instanceof Error ? reason.message : "应用启动失败"}</p>);
  });
