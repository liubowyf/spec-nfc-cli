# 个人 Skills 兼容说明

团队允许成员保留自己的 skills、提示词和本地工作流。

边界只有一条：这些能力只能影响个人工作方式，不能覆盖仓内正式规范。

仓内必须优先遵守的内容：
- `AGENTS.md / CLAUDE.md / .trae/rules/project_rules.md`
- `.specnfc/` 下的模块规则
- 当前 `specs/changes/<change-id>/`

个人 skills 不得覆盖的事项：
- 当前 change 范围
- 正式文件结构
- 最低验证要求
- 裁决点和发布边界

冲突时怎么处理：
1. 回退到仓内入口文件
2. 回退到 `.specnfc/`
3. 回退到当前 change 正式文件
4. 需要保留的判断写回 `status.md` 或 `decisions.md`

`specnfc doctor` 会检查：
- 入口文件是否写明个人 Skills 兼容规则
- governance 模块下是否存在 `personal-skills.md`
- `opencode.json` 是否把治理规则纳入 instructions

## 标准技能目录

v4.0 起，仓内技能同时生成符合 Agent Skills 标准的目录：

- `.specnfc/skill-packs/active/skills/<name>/SKILL.md`
- frontmatter 至少包含 `name` 与 `description`
- 启动时只加载 metadata，激活后才加载正文，符合渐进披露

常用命令：

```bash
specnfc skills list
specnfc skills validate
specnfc skills export --to skills
```

导出目录位于当前仓库内，可被任意支持 `SKILL.md` 的代理加载；导出前建议先运行 `specnfc skills validate`。
