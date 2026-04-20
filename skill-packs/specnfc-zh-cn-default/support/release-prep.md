# 辅助技能：发布准备（release-prep）

- 分类：delivery
- 目的：在发布前复核 compliance、安装校验、包内容和最终交付清单。

## 触发条件
- 准备 release 或发布归档时触发。

## 前置条件
- doctor / status 已运行
- 交接单与交付检查单已形成

## 输出
- 发布前检查结论
- 阻断项
- 剩余人工动作

## 默认写入
- specs/changes/<change-id>/delivery-checklist.md
- .nfc/sync/writeback-history.json

## 建议 CLI
- `specnfc doctor`

## 共通规则
- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。
- 若生成运行时中间稿，必须登记 writeback 目标。
- 输出结尾必须补一段“推荐下一步”。
- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。
