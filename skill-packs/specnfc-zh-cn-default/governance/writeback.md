# 治理技能：正式写回（writeback）

- skill-id：`writeback`
- layer：`governance`
- namespace：`specnfc.official`
- trust-tier：`governed`
- parity-reference：`oh-my-codex/writeback-playbook`
- trigger：运行时产物需要沉淀回正式 dossier 或 governance record 时触发。
- hard-gate：strict / locked 下存在 pending writeback 时，不得 accept / archive / release。

## prerequisites
- 已识别运行时产物与正式目标
- 已确认写回责任人

## outputs
- 待回写队列更新
- 写回历史追加
- 正式文档 / records 落盘

## writebacks
- `.nfc/sync/pending-writeback.json`
- `.nfc/sync/writeback-history.json`
- 目标正式 dossier / governance record

## evidence-required
- 源运行时产物引用
- 目标文档或 record 引用

## record-types
- `writeback-request`

## allowed-next
- `verify`
- `accept`
- `release-prep`

## block-on-failure
- 是

## conflict-resolution
- 正式 dossier 与 record 永远优先于运行时草稿
