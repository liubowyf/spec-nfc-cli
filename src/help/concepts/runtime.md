# 协作运行说明

`runtime` 不是单独的代码执行器，而是 `Spec nfc` 对协作推进、阶段收口与正式文档回写的最小封装。

当前已经提供：

- 协作运行规则：什么时候适合并行、协调者 / 执行者各自负责什么
- 派单与回收规则：避免只靠聊天记录推进
- 卡住时的恢复手册：先收紧范围，再回收运行状态
- 以正式文件为交付面：结果必须落回仓内文件或代码

当前推荐读取顺序：

1. `.specnfc/execution/agents.md`
2. `.specnfc/execution/dispatch.md`
3. `.specnfc/execution/handoff.md`
4. `.specnfc/execution/team-runtime.md`
5. `.specnfc/execution/team-recovery.md`

适用场景：

- 一条 change 需要多人或多 Agent 并行
- 同时需要实现、验证、治理、文档多条 lane
- 需要协调者持续收口，而不是“启动后放任”

当前边界：

- 这是协作运行规范，不是完整的企业级调度平台
- 当前更强调可执行规则、正式文件回写和收口
- 如果需要更强的可观测、审计、编排能力，还需要继续产品化
