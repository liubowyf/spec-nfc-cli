# 治理技能：验证门禁（verification-gate）

- skill-id：`verification-gate`
- layer：`governance`
- namespace：`specnfc.official`
- trust-tier：`governed`
- parity-reference：`superpowers/verification-before-completion`、`oh-my-codex/verifier`
- trigger：准备完成、handoff、archive、release 前触发。
- hard-gate：没有 fresh evidence 或没有 `verification-record(result=passed)` 时，不得进入 accept / archive / release。

## prerequisites
- 已有验证命令或验证证据
- acceptance.md 已更新

## outputs
- `verification-record`
- fresh evidence 引用
- 最终放行 / 阻断判断

## writebacks
- `specs/changes/<change-id>/evidence/verifications/<verification-id>.json`
- `specs/changes/<change-id>/acceptance.md`
- `specs/changes/<change-id>/status.md`

## evidence-required
- 测试 / 检查结果
- acceptance 摘要

## record-types
- `verification-record`

## allowed-next
- `accept`
- `archive`
- `release-prep`

## block-on-failure
- 是

## conflict-resolution
- 无 fresh evidence 时，任何外部完成声明均无效
