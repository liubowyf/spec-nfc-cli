# `integration-contract` 对接契约模块

这组文件负责同仓内多人接口 / service 对接。

适用场景：

- 同一或不同 `change` 间存在接口契约依赖
- provider / consumer 需要先明确责任与联调前置
- 需要把对接状态接入 `change check / doctor / status`

核心原则：

- 不允许只靠聊天约定对接
- 不允许接口未对齐就进入实现
- 不允许多人联调状态只存在口头同步中

推荐使用顺序：

1. 先创建 `change`
2. 再创建 `integration`
3. 补齐 `contract.md / decisions.md / status.md`
4. 先运行 `specnfc integration check`
5. 推进到 `aligned`
6. 再推进依赖它的 `change` 到 `in-progress`

固定状态：

- `draft`
- `aligned`
- `implementing`
- `integrating`
- `blocked`
- `done`

关键门禁：

- integration 若仍是 `draft` / `blocked` / 不存在
- 依赖它的 change 不允许进入 `in-progress`
