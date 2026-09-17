# ProofGrid Charge — MVP Product Brief

状态：方向冻结 · 2026-09-17  
赛道：现实世界应用与智能设备（主）/ 消费应用与支付（次）

## 一句话

ProofGrid Charge 把签名的电车充电数据转换成只能执行一次、可公开验证的 Avalanche 结算：司机预存最高费用，充电结束后按实际电量付款，余额自动退回，并生成永久可查的 Charging Receipt。

## 问题与用户

一次充电涉及司机、充电运营商和计量数据提供方。各方需要共同确认“本次交付了多少电、应付多少钱、是否已经结算”，同时防止结算前篡改电量和同一会话重复扣款。

- **司机**：只为实际充入的电量付款，支出不超过预先同意的上限。
- **充电运营商**：依据签名的最终电量获得确定付款。
- **车队与审计者**：无需依赖单一运营商的私有数据库即可验证结算收据。

ProofGrid Charge 不替代 ISO 15118、OCPP 或 OCPI；MVP 使用 OCPP 风格的模拟数据，为其增加公开、一次性的链上结算与收据层。

## 唯一主流程

1. 司机选择已登记的 Charging Station，确认固定 `pricePerWh`、`maxEnergyWh` 和截止时间。
2. 司机锁定 `maximumPayment = pricePerWh × maxEnergyWh` 的测试 AVAX，创建 Funded Charging Session。
3. Go 充电桩模拟器生成起止电表值和链下证据；已授权 Attestor 签署 EIP-712 Charging Attestation。
4. 合约验证 Session、签名、时效和 `actualEnergyWh <= maxEnergyWh`。
5. 合约只结算一次：运营商获得 `actualEnergyWh × pricePerWh`，司机获得剩余退款。
6. Session 变为 Settled，并保存公开 Charging Receipt；到期仍未结算时，司机可取回全部锁定资金。

## 不可违反的业务规则

- 每个 Charging Session 绑定唯一司机、Charging Station、运营商、费率、上限和截止时间。
- Tariff 在 Session 创建后不可修改，所有能影响付款的数据都必须包含在签名或已锁定状态中。
- 只有已授权 Attestor 的有效签名才能触发结算；修改电量、收款方或 Session ID 都必须使签名失效。
- `actualEnergyWh` 必须大于 0 且不超过 `maxEnergyWh`；最终付款不得超过 `maximumPayment`。
- 一个 Session 只能进入 Settled 或 Refunded 其中一个终态，不能重复结算或重复退款。
- Charging Receipt 是结算记录，不是 NFT 或可交易资产。
- 合约不存在管理员任意修改已结算收据或代替 Attestor 填写电量的入口。

## 信任边界

链上可以证明 Attestor 签过哪组数据、数据提交后未被修改、费率和预算按规则执行、Session 只结算一次。链上不能证明物理电表未被攻击、车辆实际收到的电量绝对正确，或 Attestor 在现实世界中诚实。MVP 明确信任一个已登记的测试 Attestor，并把其签名责任公开化。

## MVP 范围

包含：

- Fuji 上的 Session 锁款、签名结算、退款和公开收据合约。
- Go 编写的 Charging Station/OCPP 风格数据模拟器与 Attestation 签名服务。
- 司机创建 Session、运营商查看结算、公众验证 Receipt 的最小 Web 界面。
- 正常结算、篡改签名、重复结算、超额电量、签名过期和超时退款测试。
- Fuji Explorer 链接、Gas 成本和交易确认时间证据。

不包含：真实充电硬件、完整 OCPP Server、ISO 15118 PKI、充电桩地图、动态/峰谷价格、稳定币、车辆 DID、NFT、绿色电力来源证明、自建 L1、ICM 或跨链。

## 一分钟 Demo

司机为最多 20 kWh 锁定测试 AVAX；模拟充电桩报告实际交付 18.4 kWh。有效 Attestation 触发结算，运营商收到 18.4 kWh 对应费用，司机得到余额退款并看到公开 Receipt。随后把签名数据篡改为 81.4 kWh，合约返回 InvalidAttestation；再次提交原始 18.4 kWh，合约返回 SessionAlreadySettled。

## MVP 验收

- 合约和 Web Demo 已部署并可在 Fuji 实际操作。
- 正常路径完成锁款、按量付款、退款和 Receipt 查询。
- 六条关键失败/退款路径由自动化测试覆盖。
- Demo 全程不手工修改链上状态，并在 60 秒内完成。
- README 公开说明协议集成边界、Attestor 信任假设和可复现命令。

