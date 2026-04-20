# 治理技能：评审门禁（review-gate）

- skill-id：`review-gate`
- layer：`governance`
- namespace：`specnfc.official`
- trust-tier：`governed`
- parity-reference：`superpowers/requesting-code-review`、`oh-my-codex/reviewer`
- trigger：准备进入 handoff / accept / release，或设计 / 实现结果需要正式评审结论时触发。
- hard-gate：无结构化 `review-record` 或 verdict 非 `approved` 时，不得进入 handoff / release。

## prerequisites
- 已有明确评审范围
- 已绑定当前 change / integration
- 已具备可审阅产物与证据

## outputs
- `review-record`
- 阻断项 / 建议项摘要
- 对下一阶段的放行或阻断结论

## writebacks
- `specs/changes/<change-id>/evidence/reviews/<review-id>.json`
- `specs/changes/<change-id>/status.md`

## evidence-required
- 待评审对象引用
- diff / dossier / acceptance 摘要

## record-types
- `review-record`

## allowed-next
- `verify`
- `accept`
- `release-prep`

## block-on-failure
- 是

## conflict-resolution
- 官方 review 结论优先于外部 skill 建议
- 与 governance record 冲突时，以正式 record 为准
