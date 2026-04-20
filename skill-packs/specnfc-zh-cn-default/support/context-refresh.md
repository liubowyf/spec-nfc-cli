# 辅助技能：上下文刷新（context-refresh）

- 分类：context
- 目的：刷新仓级长期事实、当前 change / integration 事实与入口读取顺序。

## 触发条件
- 进入新阶段前、切换工作对象前或上下文明显漂移时触发。

## 前置条件
- 已定位当前 repo / change / integration
- 可读取 `.specnfc/` 与 `specs/`

## 输出
- 当前上下文摘要
- 缺失上下文
- 建议补读项

## 默认写入
- .nfc/context/repo-summary.md
- .nfc/context/active-focus.md

## 建议 CLI
- `specnfc status`

## 共通规则
- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。
- 若生成运行时中间稿，必须登记 writeback 目标。
- 输出结尾必须补一段“推荐下一步”。
- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。
