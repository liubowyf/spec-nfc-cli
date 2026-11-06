# `specnfc agents`

管理多代理角色、写权限边界与委派任务契约。

用法：
  specnfc agents list
  specnfc agents validate
  specnfc agents export --to .claude/agents [--force]
  specnfc agents task <role> --change <change-id> [--goal "子任务目标"]

说明：
  - 角色目录：`.specnfc/agents/roles.json`
  - 每个角色声明阶段、工具、写范围、隔离方式、停止条件与交接对象
  - `export` 生成兼容 Claude Code subagent 的 Markdown 定义
  - `task` 在 `.nfc/tasks/` 下生成可委派的任务契约，并可携带 traceId

示例：
  specnfc agents list
  specnfc agents validate
  specnfc agents export --to .claude/agents
  specnfc agents task executor --change risk-device-link --goal "补齐回归测试"