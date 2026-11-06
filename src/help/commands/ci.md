# `specnfc ci`

运行完整协议门禁，供本地或 CI 使用。

用法：
  specnfc ci [--suite smoke] [--allow-approval] [--skip-eval]

检查项：
  - 仓库结构、缺失文件与协议风险
  - 合规阻塞项
  - Agent Skills 标准
  - Agent 角色与阶段覆盖
  - MCP 工具策略
  - 权限清单
  - AGENTS.md 标准与规模
  - eval smoke suite

说明：
  - 存在阻塞项时返回非零退出码
  - 提示项不阻断，但会列入 advisory
  - eval 用例执行前会检查权限清单；命中 requireApproval 的命令需要 `--allow-approval`
  - 适合放在 CI 的 required check 中

示例：
  specnfc ci
  specnfc ci --json
  specnfc ci --skip-eval