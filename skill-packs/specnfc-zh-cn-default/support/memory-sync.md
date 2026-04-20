# 辅助技能：记忆同步（memory-sync）

- 分类：memory
- 目的：同步项目长期记忆、运行笔记与正式 dossier 的一致性。

## 触发条件
- 运行时中间稿已经形成，需要写回正式索引或 dossier 时触发。

## 前置条件
- 存在待写回项或上下文索引漂移
- `.nfc/sync/*` 可写

## 输出
- 待同步记忆项
- 写回目标
- 同步结果

## 默认写入
- .nfc/sync/pending-writeback.json
- .nfc/sync/writeback-history.json

## 建议 CLI
- `specnfc status`

## 共通规则
- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。
- 若生成运行时中间稿，必须登记 writeback 目标。
- 输出结尾必须补一段“推荐下一步”。
- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。
