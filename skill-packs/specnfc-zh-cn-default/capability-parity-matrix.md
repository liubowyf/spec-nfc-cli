# Capability Parity Matrix

| specnfc 官方 skill | 参考项目 | 参考 skill | 借鉴能力点 | 在 specnfc 中的保留方式 | 允许差异 | 对应 evidence / gate | 对应测试 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| clarify | superpowers | brainstorming | 先澄清问题、范围、非目标 | workflow/clarify + proposal/status writeback | 不复制 superpowers 运行方式 | proposal gate | cli / change gate 回归 |
| design | oh-my-codex | ralplan / architect | 方案、约束、权衡、验证思路 | workflow/design + spec/capabilities/spec-deltas | 不引入 team runtime | design/spec section gate | cli / doc-contract 回归 |
| plan | superpowers | writing-plans | 任务切分、验证计划、依赖顺序 | workflow/plan + tasks/decisions | 保持 specnfc dossier 结构 | plan gate + review/approval | cli / workflow 回归 |
| systematic-debugging | superpowers | systematic-debugging | 先复现再定位再修复 | workflow/systematic-debugging + governance 纪律 | 不依赖外部 skill 才能执行 | execute 前 root-cause gate | regression / governance 回归 |
| review-gate | superpowers | requesting-code-review | 正式评审与 verdict | governance/review-gate + review-record | 使用 specnfc record，而非外部评论 | review-record gate | governance-records 回归 |
| verification-gate | superpowers | verification-before-completion | 完成前 fresh evidence | governance/verification-gate + verification-record | 证据对象由 specnfc 定义 | verification-record gate | verification-regression 回归 |
| writeback | oh-my-codex | writeback playbook | 运行时产物回流正式 dossier | governance/writeback + .nfc/sync/* | `.specnfc/` 仍是真相源 | pending writeback gate | status / doctor / release 回归 |
| release-prep | oh-my-codex | release-preflight | 发布前协议、包内容、安装验证总检 | support/release-prep + release gate | 不引入外部 runtime 主导发布 | release-decision / install verify | release regression 回归 |
