# 辅助技能：风险复核（risk-review）

- 分类：governance
- 目的：在阶段切换前复核风险、阻断项与可接受的例外。

## 触发条件
- 准备切换阶段、提交 handoff 或判断是否需要 waiver 时触发。

## 前置条件
- 已收集当前阻断与剩余风险
- status.md / acceptance.md 可读

## 输出
- 风险列表
- 阻断判断
- 是否需要 waiver

## 默认写入
- specs/changes/<change-id>/status.md
- specs/changes/<change-id>/acceptance.md

## 建议 CLI
- `specnfc doctor`

## 共通规则
- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。
- 若生成运行时中间稿，必须登记 writeback 目标。
- 输出结尾必须补一段“推荐下一步”。
- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。
