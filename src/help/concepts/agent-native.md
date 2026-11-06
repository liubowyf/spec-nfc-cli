# Agent 原生能力

`Spec nfc` v4.0 在既有 spec 协议之上增加一层可执行的 Agent 原生对象。

## 标准对照

| 标准 | 仓内落点 |
| --- | --- |
| AGENTS.md | 根目录 `AGENTS.md` + 可选嵌套文件；就近优先 |
| Agent Skills | `.specnfc/skill-packs/active/skills/<name>/SKILL.md` |
| MCP `2026-07-28` | `.specnfc/mcp/policy.json` |
| 多代理角色 | `.specnfc/agents/roles.json` 与 `roles/<name>.md` |
| 委派契约 | `.nfc/tasks/<task-id>.json` |
| 评测 | `.specnfc/evals/manifest.json` 与 `.nfc/evals/results/` |
| 权限 | `.specnfc/security/permissions.json` |
| 追溯 | `.specnfc/traceability/<change-id>.json` |

## 常用命令

```bash
specnfc skills list
specnfc skills validate
specnfc skills export --to skills

specnfc agents list
specnfc agents validate
specnfc agents export --to .claude/agents
specnfc agents task executor --change <change-id>

specnfc eval list
specnfc eval run --suite smoke

specnfc trace <change-id>
specnfc security check
specnfc ci
```

## 设计原则

- **渐进披露**：技能启动时只加载 name / description，激活后再加载正文与引用文件。
- **frontmatter 子集**：当前只解析标量字段与一层 `metadata` 映射；复杂 YAML 结构请放在正文或 references 中。
- **最小权限**：默认拒绝；写范围、命令、网络出口、MCP 工具都必须显式声明。
- **不可信内容不执行**：网页、issue、PR、外部 skill、MCP 返回值只作为数据处理。
- **可追溯**：需求、验收、任务、证据使用稳定编号，缺口可被 CI 阻断。
- **工具中立**：角色与任务契约不绑定具体代理；导出时再适配。

## 与阶段机的关系

- `clarify / design`：只读为主，禁止写工具与网络出口。
- `plan`：允许生成正式计划文档，写操作需要审批。
- `execute / verify`：允许受控写与运行验证命令，必须携带任务契约与 traceId。
- `accept / archive`：发布动作必须有人工审批记录。