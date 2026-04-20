# 规格成熟度说明

`maturity` 用来说明一个 change 的正式文件现在处于什么成熟度，以及下一步该补什么。

当前状态枚举：

- `draft`：核心规格还没补完整，通常还缺 `01-需求与方案 / 02-技术设计与选型 / 03-任务计划与执行`
- `incomplete`：主规格已成型，但当前阶段关键章节仍未闭合
- `implementation`：已经进入实现或验证阶段
- `handoff`：已经达到交接前状态
- `ready`：规格基本可进入实现
- `archived`：已经完成并归档
- `broken`：元信息或关键文件异常
- `unknown`：当前信息不足，无法判断

`specnfc change check` 现在不仅会给出总状态，还会细分关键缺口，例如：

- `MISSING_REQUIREMENTS_SCOPE`
- `MISSING_REQUIREMENTS_ACCEPTANCE`
- `MISSING_TECHNICAL_CONSTRAINTS`
- `MISSING_TECHNICAL_VERIFICATION`
- `MISSING_EXECUTION_STATUS`
- `MISSING_EXECUTION_NEXT`

理解方式：

1. 先看 `maturity.summary`
2. 再看 `maturity.action`
3. 如需自动化消费，再看 `maturity.gaps`

推荐做法：

- `draft`：先把 `01-需求与方案.md` 的关键章节补到能被别人接手；如触发技术设计，再补 `02-技术设计与选型.md`
- `incomplete`：把当前阶段要求的关键章节补齐，不要跳阶段
- `implementation`：把验证结果和风险写回正式文件，不要只留在聊天记录
- `handoff`：补 `04-验收与交接.md` 与 `release-handoff.md`，确认交付项后再归档

配套命令：

- `specnfc change check <change-id>`
- `specnfc doctor`
- `specnfc status`
