# 辅助技能：文档规范化（normalize-doc）

- 分类：quality
- 目的：按文档合同补齐 section、去除占位内容并统一表达。

## 触发条件
- check / doctor 提示 section 缺失、占位内容或表达不一致时触发。

## 前置条件
- 已识别目标文档与缺失 section
- 对应 document contract 可读

## 输出
- 缺失 section
- 建议修订项
- 规范化结果

## 默认写入
- 当前正在处理的正式 dossier 文档

## 建议 CLI
- `specnfc doctor`

## 共通规则
- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。
- 若生成运行时中间稿，必须登记 writeback 目标。
- 输出结尾必须补一段“推荐下一步”。
- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。
