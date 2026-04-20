# 辅助技能：完成前验证（verify-before-complete）

- 分类：discipline
- 目的：在宣称完成、进入 handoff 或准备 release 前，核对验证命令、证据和剩余风险。

## 触发条件
- 准备宣称完成、提交交接或执行发布前触发。

## 前置条件
- 已有待声明的完成结果
- 可运行验证命令或已有验证证据

## 输出
- 验证命令与结果
- 剩余风险
- 是否允许完成 / handoff / release 的判断

## 默认写入
- specs/changes/<change-id>/acceptance.md
- specs/changes/<change-id>/status.md
- specs/changes/<change-id>/delivery-checklist.md

## 建议 CLI
- `specnfc doctor`

## 共通规则
- 不得替代 `.specnfc/` 与正式 dossier 的真相源地位。
- 若生成运行时中间稿，必须登记 writeback 目标。
- 输出结尾必须补一段“推荐下一步”。
- 在 strict / locked 模式下，行为纪律类技能未完成时不得跳过进入下游阶段。
