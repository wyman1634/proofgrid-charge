# ProofGrid Charge

Ticket #2 建立第一个可运行纵向切片：Driver 通过公开 Web 界面查看已配置的 Charging Station，确认锁定条款，并在本地 Avalanche-compatible EVM 上准确出资创建 `Funded` Charging Session。

## 本地启动

要求 Node.js 24、npm 和 Go 1.24+。首次克隆后先安装依赖：

```bash
npm install
```

随后一条命令启动本地 EVM、部署并配置合约、Go 服务和 Web 应用：

```bash
npm run dev
```

打开 <http://127.0.0.1:5173>。浏览器钱包需连接本地网络（Chain ID `31337`，RPC `http://127.0.0.1:8545`）；应用会在连接时请求添加或切换网络。测试账户和余额由每次启动的临时 Hardhat 节点提供，仓库不保存私钥或其他秘密配置。

Go 服务的健康检查位于 <http://127.0.0.1:8080/healthz>。

## 验证

```bash
npm run typecheck
npm test
npm run build
```

当前范围只包含 Charging Station 配置与 Charging Session 创建/出资。Attestation、Settlement、Charging Receipt 和 Timeout Refund 留给后续 Tickets。
