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

## Agent 原生标准对照（v4.0）

| specnfc 能力 | 参考标准 / 项目 | 借鉴能力点 | 在 specnfc 中的落点 | 允许差异 | 对应测试 |
| --- | --- | --- | --- | --- | --- |
| Agent Skills | agentskills.io `SKILL.md` | frontmatter、渐进披露、按需加载引用文件 | `.specnfc/skill-packs/active/skills/<name>/SKILL.md` | 正文保持中文团队写法 | `agent-native` skills 用例 |
| AGENTS.md | agents.md（LF Agentic AI Foundation） | 标准入口、嵌套就近优先、规模可控 | 根 `AGENTS.md` + 入口检查 | 额外加入 specnfc 阶段机说明 | `agent-native` 入口用例 |
| MCP 工具策略 | MCP `2026-07-28` | stateless、MRTR、按工具授权、废弃能力识别 | `.specnfc/mcp/policy.json` | 未实现 MCP server 运行时 | `agent-native` MCP / ci 用例 |
| 多代理角色 | Claude Code subagents、orchestrator-worker | 角色、工具、隔离、停止条件、交接 | `.specnfc/agents/roles.json` + 导出 | 工具名使用通用名称，导出时映射 | `agent-native` 角色用例 |
| 委派契约 | 多代理编排实践 | traceId、预算、验收标准、worktree 隔离 | `.nfc/tasks/<task-id>.json` | 不绑定具体编排框架 | `agent-native` task 用例 |
| 评测门禁 | Spec Kit / CI 实践 | 可运行用例、结果落盘、失败阻断 | `.specnfc/evals/*` | 使用 shell 命令而非专用框架 | `agent-native` eval 用例 |
| 权限清单 | OWASP AI Agent Security Cheat Sheet | 默认拒绝、最小权限、审批、不可信内容 | `.specnfc/security/permissions.json` | 未内置沙箱运行时 | `agent-native` security 用例 |
| 需求追溯 | Spec Kit tasks / EARS 实践 | 需求 → 验收 → 任务 → 证据闭环 | `REQ / AC / TASK / EV` + `specnfc trace` | 使用显式编号而非语义推断 | `agent-native` trace 用例 |
