# 状态

## 基本信息

- Change：`agent-native-runtime-v4`
- 当前阶段：`handoff`
- 最近更新：2026-11-06

## 当前结论

- Agent 原生层已实现并接入 `init / upgrade / doctor / ci`。
- 新增 6 个命令面与 7 个设计 schema。
- 新增 11 个端到端测试；全量 232/232 通过。
- 默认生成配置在临时仓 `specnfc ci` 通过；越界配置可被阻断。

## 已完成

- Agent Skills 标准生成、校验与导出
- MCP 工具策略与检查
- 角色目录、导出与委派任务
- 评测 manifest、运行器与结果落盘
- 权限清单与不可信内容策略
- AGENTS.md 标准与规模检查
- 需求追溯矩阵与模板编号
- 统一 CI 与 GitHub Actions 模板
- README / CHANGELOG / 版本号

## 待跟进

- 在真实团队仓跑一轮 `specnfc upgrade`，观察受管文件冲突。
- 接入真实 MCP server 后补充 server 清单与工具授权。
- 收集一轮真实 agent 评测结果，校准默认阈值。

## 剩余风险

- 角色工具名需要按代理做映射。
- eval 断言类型目前较基础。
- MCP 默认策略未包含真实 server 示例。

## 证据

- 代码：`src/kernel/agent-*.mjs`、`mcp-policy.mjs`、`security-policy.mjs`、`evals.mjs`、`traceability.mjs`
- 命令：`src/commands/{skills,agents,eval,trace,security,ci}.mjs`
- 测试：`tests/agent-native.test.mjs`
- 文档：`01-需求与方案.md`、`02-技术设计与选型.md`、`04-验收与交接.md`
- 验证记录：`evidence/verifications/verification-001.json`