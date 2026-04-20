# 治理技能：豁免复核（waiver-review）

- skill-id：`waiver-review`
- layer：`governance`
- namespace：`specnfc.official`
- trust-tier：`governed`
- parity-reference：`specnfc/waiver-policy`
- trigger：出现 projection drift、skill-pack drift、imports 合规例外等需要豁免时触发。
- hard-gate：无有效 waiver 或 waiver 过期 / 非法时，不得绕过对应 blocking issue。

## prerequisites
- 已识别明确阻断项
- 已说明豁免范围、原因、时效和批准人

## outputs
- `waiver-record`
- 生效范围与过期时间
- 对 doctor / release 的影响结论

## writebacks
- `.specnfc/governance/waivers/<waiver-id>.json`

## evidence-required
- 被豁免对象
- 原因与影响说明

## record-types
- `waiver-record`

## allowed-next
- `doctor`
- `release-prep`

## block-on-failure
- 是

## conflict-resolution
- 过期或非法 waiver 不具放行效力
