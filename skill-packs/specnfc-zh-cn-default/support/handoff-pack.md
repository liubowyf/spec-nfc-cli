# 辅助技能：交接整理（handoff-pack）

- 分类：delivery
- 目的：整理变更摘要、风险、回退、验证和交接状态。

## 触发条件
- 准备 handoff、archive 或 release 前触发。

## 前置条件
- 已有 acceptance 结论
- 交付材料基本齐备

## 输出
- 交接摘要
- 发布影响
- 回退信息

## 默认写入
- specs/changes/<change-id>/release-handoff.md
- specs/changes/<change-id>/delivery-checklist.md

## 建议 CLI
- `specnfc change handoff <change-id>`

## 共通规则
- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。
- 若生成运行时中间稿，必须登记 writeback 目标。
- 输出结尾必须补一段“推荐下一步”。
- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。
