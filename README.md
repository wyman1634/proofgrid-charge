# ProofGrid Charge

ProofGrid Charge 当前支持从准确出资到首次 Settlement 的完整纵向切片：Driver 创建 `Funded` Charging Session，Go 服务生成确定性原始充电数据、Evidence Hash 和 EIP-712 Charging Attestation，任意 relayer 通过 Web 钱包提交后获得公开可查询的 Charging Receipt。

## 本地启动

要求 Node.js 24、npm 和 Go 1.24+。首次克隆后先安装依赖：

```bash
npm install
```

随后一条命令启动本地 EVM、部署并配置合约、Go 服务和 Web 应用：

```bash
export PROOFGRID_ATTESTOR_PRIVATE_KEY=0xYOUR_DEMO_PRIVATE_KEY
npm run dev
```

打开 <http://127.0.0.1:5173>。浏览器钱包需连接本地网络（Chain ID `1337`，RPC `http://127.0.0.1:8545`）；应用会在连接时请求添加或切换网络。测试账户和余额由每次启动的临时 Hardhat 节点提供，仓库不保存私钥或其他秘密配置。

`PROOFGRID_ATTESTOR_PRIVATE_KEY` 同时决定部署时锁定的 Attestor 地址与 Go 服务的签名身份。该值只从环境读取，不会写入部署文件或日志。Go 服务的健康检查位于 <http://127.0.0.1:8080/healthz>，Charging Attestation API 位于 `POST /attestations`。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

## Avalanche Fuji 发布

Fuji 发布使用公开的 Go Attestor 和静态 Web。将 Web 部署到 GitHub Pages，并把 Attestor 容器部署到 Render；两者的 URL 必须是 HTTPS。私钥只保存在本机 `.env` 或平台 Secret 中，绝不能提交或复制到客户端构建产物。

1. 以 [`.env.example`](.env.example) 建立本机 `.env`，填入独立 Attestor 私钥、Charging Operator 地址和暂定的公开 Attestor URL。部署账户可沿用之前作业保存在本机的加密 Fuji keystore；它不会被复制到本仓库。
2. 在 Render 通过 `render.yaml` 创建 Attestor 服务，先填入 `PROOFGRID_ATTESTOR_PRIVATE_KEY`。`GET /healthz` 在公开 HTTPS URL 返回 `{"status":"ok"}` 后，将该 URL 写入本机的 `FUJI_ATTESTOR_URL`。
3. 对于加密的本机 keystore，还应设置 `FUJI_KEYSTORE_ENV_PATH`、`FUJI_KEYCHAIN_SERVICE` 和 `FUJI_KEYCHAIN_ACCOUNT`。在已加载这些环境变量的 shell 中运行：

   ```bash
   npm run deploy:fuji:keychain
   npm run build
   ```

   前一条命令会在运行时从 macOS Keychain 解密已有 keystore，生成仅包含公开地址的 `web/public/deployment.json`，并把合约地址、部署与 Charging Station 配置交易、区块号和 gas 用量写入 `deployments/fuji.json`。CI 可设置 `FUJI_DEPLOYER_PRIVATE_KEY` 后改用 `npm run deploy:fuji`。
4. `render.yaml` 先使用安全零值占位，因此服务仅能通过健康检查、不能为真实合约签名。从 `deployments/fuji.json` 复制 `contractAddress`、`stationIdHash`，并将它们与 `FUJI_CHARGING_OPERATOR_ADDRESS` 分别填到 Render 的 `PROOFGRID_VERIFYING_CONTRACT`、`PROOFGRID_STATION_ID`、`PROOFGRID_CHARGING_OPERATOR` 后重新部署 Attestor。Fuji 模式会拒绝任何其他链、合约、Station 或 Operator 的签名请求。
5. 将以下**仅包含公开字段**的 JSON 写入 GitHub Actions Secret `FUJI_DEPLOYMENT_JSON`，再手动运行 `Publish Fuji web demo` 工作流；它会发布 GitHub Pages。部署者、Attestor 私钥和任何 funded credential 都不会写入静态 bundle：

   ```json
   {"chainId":43113,"contractAddress":"0x...","rpcUrl":"https://api.avax-test.network/ext/bc/C/rpc","attestorUrl":"https://your-attestor.onrender.com","stationId":"station-fuji-001"}
   ```

   同时把 `contractAddress` 写入本机 `.env` 的 `FUJI_CONTRACT_ADDRESS`。

部署完成后，在同一环境运行 `npm run smoke:fuji`。脚本会先预检公开 Attestor，再为唯一的 `FUJI_SMOKE_SESSION_ID` 执行真实 Funded → Settled，读取公开 Charging Receipt，并验证篡改 Actual Energy 与重复 Settlement 都被拒绝。若出资后失败，短 Deadline 到期后脚本会自动执行 Timeout Refund；每次运行独立 Session，不会影响下一场景。它会把交易、gas、确认耗时和 Snowtrace 链接写入 `deployments/fuji-smoke/<session>.json`。

Fuji deploy 脚本要求 `FUJI_RPC_URL`、`FUJI_DEPLOYER_PRIVATE_KEY`、`PROOFGRID_ATTESTOR_PRIVATE_KEY`、`FUJI_CHARGING_OPERATOR_ADDRESS` 和 `FUJI_ATTESTOR_URL`；启动前会校验格式，并拒绝 HTTP 或 localhost Attestor URL。
