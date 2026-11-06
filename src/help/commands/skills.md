# `specnfc skills`

管理仓内 Agent Skills（`SKILL.md` 标准）。

用法：
  specnfc skills list [--layer workflow|support|governance]
  specnfc skills validate
  specnfc skills export --to skills [--only a,b] [--force]

说明：
  - 仓内 active skills 位于 `.specnfc/skill-packs/active/skills/<name>/SKILL.md`
  - active skills 属于受管产物；如需长期定制，请修改 skill-pack 源或导出后再改
  - `validate` 校验 frontmatter、命名规范、description 长度与正文规模
  - `export` 把技能导出为可被任意支持 Agent Skills 的代理加载的目录
  - `--to` 必须位于当前仓库内

示例：
  specnfc skills list
  specnfc skills validate
  specnfc skills export --to skills
  specnfc skills export --to .claude/skills --only clarify,design