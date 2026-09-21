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

当前范围包含 T01 创建/出资与 T02 首次有效 Settlement。无效或被篡改的 Charging Attestation、重复 Settlement、Timeout Refund 和 Fuji 发布留给后续 Tickets。
