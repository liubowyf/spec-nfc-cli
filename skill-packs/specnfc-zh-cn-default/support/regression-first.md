# 辅助技能：回归优先（regression-first）

- 分类：discipline
- 目的：在修 bug、改行为或做高风险重构前，先固定失败证据与回归验证路径。

## 触发条件
- 涉及缺陷修复、行为变更或高风险重构时触发。

## 前置条件
- 已知目标行为或失败症状
- 存在 active change

## 输出
- 失败证据
- 回归用例 / 验证计划
- 是否允许继续编码的判断

## 默认写入
- specs/changes/<change-id>/plan.md
- specs/changes/<change-id>/status.md

## 建议 CLI
- `specnfc change check <change-id>`

## 共通规则
- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。
- 若生成运行时中间稿，必须登记 writeback 目标。
- 输出结尾必须补一段“推荐下一步”。
- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。
