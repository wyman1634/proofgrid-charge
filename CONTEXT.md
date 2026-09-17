# ProofGrid Charge

ProofGrid Charge 将一次签名的电车充电结果转换成只能执行一次的链上结算，并为司机、运营商和审计者提供共享的最终状态。

## Language

**Charging Session**:
一次由司机预先出资、绑定特定 Charging Station、Tariff、能量上限和截止时间的充电授权。
_Avoid_: Transaction, order, charging record

**Charging Station**:
由 Charging Operator 管理、在系统中具有唯一标识的物理充电端点；MVP 中一个 Station 视为一个可用充电设备。
_Avoid_: Pile, machine

**Charging Operator**:
管理 Charging Station 并接收已结算充电费用的组织或钱包主体。
_Avoid_: Merchant, seller

**Driver**:
创建并出资 Charging Session、接收未使用预算退款的车辆使用者钱包。
_Avoid_: Buyer, customer, user

**Tariff**:
Charging Session 创建时锁定的每 Wh 固定价格。
_Avoid_: Quote, dynamic price

**Maximum Payment**:
司机按 Tariff 和最大授权电量锁定的最高费用。
_Avoid_: Stake, collateral

**Attestor**:
被系统授权、对最终充电摘要签名并为该声明负责的主体；它不等同于对物理事实的绝对证明者。
_Avoid_: Oracle, truth provider, verifier

**Charging Attestation**:
Attestor 对 Session ID、Charging Station、实际电量、收款方、证据哈希和有效期作出的结构化签名声明。
_Avoid_: Meter proof, receipt

**Actual Energy**:
Charging Attestation 声明本次 Session 实际交付的电量，以整数 Wh 表示。
_Avoid_: Verified energy, guaranteed energy

**Evidence Hash**:
链下原始充电数据的数字摘要，用于核对内容是否与 Attestor 签名时一致。
_Avoid_: Evidence, raw meter data

**Settlement**:
根据锁定 Tariff 和 Actual Energy，只执行一次的运营商付款与司机余额退款。
_Avoid_: Charge, transfer, billing

**Charging Receipt**:
Settled Session 的永久可查询记录，包含参与方、Actual Energy、付款、退款和证据摘要；它不是可交易资产。
_Avoid_: NFT, certificate, token

**Timeout Refund**:
Charging Session 到期且尚未 Settlement 时，司机取回全部 Maximum Payment 的终态操作。
_Avoid_: Cancellation, chargeback
