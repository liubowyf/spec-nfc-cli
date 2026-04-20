# 辅助技能：下一步推荐（next-step）

- 分类：control-plane
- 目的：统一输出当前阶段、已完成、缺失 / 阻断和推荐下一步。

## 触发条件
- 每次 check / stage / doctor / status 之后都应触发。

## 前置条件
- 当前阶段、阻断与完成态已可计算

## 输出
- 标准 next-step contract
- 人类可读 next-step 摘要

## 默认写入
- .specnfc/execution/next-step.json

## 建议 CLI
- `specnfc status --json`

## 共通规则
- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。
- 若生成运行时中间稿，必须登记 writeback 目标。
- 输出结尾必须补一段“推荐下一步”。
- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。
