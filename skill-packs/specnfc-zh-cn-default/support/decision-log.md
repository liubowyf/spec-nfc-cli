# 辅助技能：决策记录（decision-log）

- 分类：decision
- 目的：把口头结论、对比过程和拒绝方案收口到正式决策记录。

## 触发条件
- 出现方案取舍、边界变化、拒绝方案或重要结论时触发。

## 前置条件
- 已有明确决策或争议点
- 已绑定当前 change

## 输出
- 已确认决策
- 被拒绝方案
- 待确认项

## 默认写入
- specs/changes/<change-id>/decisions.md

## 建议 CLI
- `specnfc change check <change-id>`

## 共通规则
- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。
- 若生成运行时中间稿，必须登记 writeback 目标。
- 输出结尾必须补一段“推荐下一步”。
- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。
