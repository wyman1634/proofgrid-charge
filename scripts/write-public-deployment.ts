import { mkdir, writeFile } from "node:fs/promises";
import { readPublicFujiDeployment } from "./public-deployment-config";

async function main() {
  const deployment = readPublicFujiDeployment(process.env.FUJI_DEPLOYMENT_JSON ?? "");
  await mkdir("web/public", { recursive: true });
  await writeFile("web/public/deployment.json", `${JSON.stringify(deployment, null, 2)}\n`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
