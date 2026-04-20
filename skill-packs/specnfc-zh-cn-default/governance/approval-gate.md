# 治理技能：审批门禁（approval-gate）

- skill-id：`approval-gate`
- layer：`governance`
- namespace：`specnfc.official`
- trust-tier：`governed`
- parity-reference：`specnfc/repository-governance`
- trigger：高风险 execute、handoff、release 前需要正式审批时触发。
- hard-gate：无 `approval-record` 或 decision 非 `approved` 时，不得进入高风险 execute / release。

## prerequisites
- 已形成 review 结论
- 需要进入高风险阶段或 repo 级发布

## outputs
- `approval-record`
- 审批范围与生效条件
- 审批后的剩余人工动作

## writebacks
- `specs/changes/<change-id>/evidence/approvals/<approval-id>.json`
- `specs/changes/<change-id>/status.md`

## evidence-required
- 对应 review / verification 引用
- 风险摘要与回退说明

## record-types
- `approval-record`

## allowed-next
- `execute`
- `accept`
- `release-prep`

## block-on-failure
- 是

## conflict-resolution
- 仅正式 `approval-record` 有放行效力
