# 辅助技能：请求代码评审（request-review）

- 分类：discipline
- 目的：在宣称 ready / handoff 前，形成明确的 review 请求、范围和结构化结论。

## 触发条件
- 准备进入 verify、handoff 或 release 前触发。

## 前置条件
- 待评审范围已明确
- 代码 / 设计 / 契约结果可被审阅

## 输出
- review 请求范围
- review 结论
- 阻断项与建议项

## 默认写入
- specs/changes/<change-id>/evidence/reviews/<review-id>.json
- specs/changes/<change-id>/status.md

## 建议 CLI
- `specnfc change check <change-id>`

## 共通规则
- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。
- 若生成运行时中间稿，必须登记 writeback 目标。
- 输出结尾必须补一段“推荐下一步”。
- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。
