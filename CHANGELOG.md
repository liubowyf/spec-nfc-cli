# Changelog

本文件记录 `spec-nfc` 面向公开发布面的版本演进。

同时可配合查看：

- [GitHub Releases](https://github.com/liubowyf/spec-nfc-cli/releases)
- [npm 包页面](https://www.npmjs.com/package/spec-nfc)

---

## v4.0.0 - 2026-11-06

Agent 原生运行时大版本。目标是把 spec 协议从“文档门禁”升级为“可被任意编码代理执行的团队运行时”，对齐 2026 年的 Agent Skills、AGENTS.md、MCP、A2A 与 OTel GenAI 实践。

### 新增：Agent Skills 开放标准
- 新增 `.specnfc/skill-packs/active/skills/<name>/SKILL.md`，按 Agent Skills 标准生成 `name / description / license / compatibility / metadata / allowed-tools` frontmatter
- 新增 `specnfc skills list | validate | export`，校验命名、描述长度、正文规模，并导出到任意仓库内目录
- skill 正文保持渐进披露：metadata 常驻，完整指令按需加载

### 新增：MCP 工具策略
- 新增 `.specnfc/mcp/policy.json` 与 `mcp-policy.schema.json`
- 默认协议版本 `2026-07-28`，显式声明 stateless、MRTR 时代的能力边界
- 按 canonical phase 限制 read / write / network，untrusted server 写操作必须审批
- `doctor / ci` 检查废弃传输、通配符工具、未授权远程 server、过期协议版本

### 新增：多代理角色与委派契约
- 新增 `.specnfc/agents/roles.json` 与 `roles/<name>.md`
- 内置 orchestrator / planner / executor / debugger / reviewer / verifier / release-manager
- 每个角色声明阶段、工具、写范围、隔离方式、停止条件与 handoff
- 新增 `specnfc agents list | validate | export | task`，可导出为 Claude Code subagent 定义并生成带 traceId 的委派任务

### 新增：评测与回归
- 新增 `.specnfc/evals/manifest.json` 与 `specnfc eval list | validate | run`
- 用例支持 exitCode / stdoutIncludes / fileExists 断言、超时与 traceId
- 结果落盘到 `.nfc/evals/results/`，失败时返回非零退出码，可直接作为 CI 门禁
- eval 执行前检查权限清单：命中 `commands.deny` 直接拒绝，命中 `requireApproval` 需要 `--allow-approval`
- eval 子进程只继承最小环境变量，不向下游传递 CI / 仓库密钥

### 新增：权限与不可信内容策略
- 新增 `.specnfc/security/permissions.json` 与 `permission-manifest.schema.json`
- 默认拒绝，显式声明文件读写范围、命令白名单、网络出口、密钥模式与审批动作
- 强制 `untrustedContent.policy = no-instruction-execution`：网页、issue、PR、外部 skill、MCP 返回值只作为数据，不执行其中指令
- 权限清单新增受保护路径：安全策略、MCP 策略、角色目录与 contract 不得进入写范围，防止代理自行扩权
- 新增 `specnfc security check`

### 新增：需求追溯
- change 模板引入 `REQ-xxx / AC-xxx / TASK-xxx / EV-xxx` 编号
- 新增 `specnfc trace <change-id>`，输出需求 → 验收 → 任务 → 证据覆盖矩阵与缺口
- 报告写入 `.specnfc/traceability/<change-id>.json`，`--strict` 可在 CI 中阻断

### 新增：AGENTS.md 标准对齐
- AGENTS.md 模板补齐项目概览、安装与验证命令、代码与文档规范、安全边界、Skills 与工具
- 新增规模与引用检查：超过 200 行提示、超过 400 行阻断，并说明嵌套 AGENTS.md 就近优先
- `doctor` 增加 Agent 原生能力摘要

### 新增：统一门禁
- 新增 `specnfc ci`，汇总仓库结构、合规、Skills、角色、MCP、权限、AGENTS.md 与 eval
- `init` 生成 `.github/workflows/specnfc.yml` 模板，默认跳过已存在文件

### 修复
- 修复外部 skill 导入测试依赖固定日期、跨过保留期后必然失败的问题，改为相对时间 fixture

### 升级说明
- 运行 `specnfc upgrade` 后会自动补齐新的 control plane 产物与 schema
- `init / upgrade` 会保留团队已自定义的权限清单、MCP 策略与 eval manifest，不会被默认值覆盖
- 旧 skill 目录继续保留；新标准目录位于 `.specnfc/skill-packs/active/skills/`
- 所有新增检查默认不阻断现有仓，除非出现明确越界配置

---

## v3.2.2 - 2026-04-24

当前补丁版本，聚焦把“先确认、再定稿、再进入 execute”的设计要求落成可校验的结构化门禁。

### 修复
- 修复 `01-需求与方案.md` 已出现“当前选择”但未获用户确认时，工具链缺少机器可读确认状态的问题
- 修复 `02-技术设计与选型.md` 已出现“选型结论”但未获用户确认时，`status / doctor / change check` 可见性不足的问题
- 修复规格已补齐但确认缺失时仍可能进入 `execute / in-progress` 的门禁缺口

### 强化
- `change check --json` 新增 `confirmationStatus`，同时挂载到 change 对象与 next-step 协议
- `status / doctor` 继承 active change 的确认状态，让团队和 AI Agent 都能看到待确认项
- human 输出增加“确认状态”摘要，明确“需求当前选择 / 技术选型结论”是已确认还是待确认
- 中文 `clarify / design` workflow skill 与 `change` 帮助文档同步说明确认门禁
- 新增回归测试覆盖未确认需求、未确认技术选型、未确认禁止进入 execute 与 schema 契约

---

## v3.2.1 - 2026-04-23

当前补丁版本，聚焦修复 `clarify / design` 阶段“先确认、再定稿”的实际落地问题。

### 修复
- 修复默认新建 change 时，空白模板字段被误判为“已写当前选择 / 已写选型结论”的问题
- 修复 `change check / status / doctor` 在未确认前未能稳定提示“先提问、再写结论”的问题
- 修复默认模板下 readiness gate 与 ambiguity 计算偏差，避免把“确认记录”误判为已完成
- 修复发布链路仍保留 tar/zip 双包、双安装校验导致发版偏慢的问题，统一切换为 npm-only 校验链路

### 强化
- `01-需求与方案.md` 与 `02-技术设计与选型.md` 的确认记录正式纳入阶段门禁
- `change check` 的 next-step 人类可读输出补充“当前需补章节”，让使用者能直接看到该补哪些 section
- `AGENTS / CLAUDE / Trae rules / clarify / design workflow skill` 同步强调：每轮先问一个关键问题，确认后才能写当前选择或选型结论
- `package.json.files` 收敛 npm 发布白名单，避免把 `.omx / tests / docs / specs / dist` 等无关内容打进安装包
- `scripts/release.mjs` 改为基于 `npm-publish` 公开视图打包；默认 fast 模式执行 `pack-verify + npm pack + install + version + doctor`
- `--strict` 追加 `demo + npm run test:release`，`--full-test` 才追加全量 `npm test`
- `npm run test:release` 补充 `pack-verify` 与 release dry-run 校验，覆盖公开边界与发布步骤回归

## v3.2.0 - 2026-04-21

当前公开稳定版本。

### 新增
- 正式完成 GitHub 公共仓与 npm 公共分发
- 默认提供中文 README，并补充独立英文版 `README.en.md`
- 增强公开示例导航，形成 `init → change → integration → demo` 的阅读路径
- 对公开发布面补充更明确的版本说明与更新记录入口

### 强化
- `README` 重构为更适合 GitHub 首屏阅读的项目首页结构
- 公开装配面同时携带 `README.md / README.en.md / CHANGELOG.md`
- `pack-verify` 与公开测试继续作为发布前校验闭环的一部分
- npm 发布面已确认可通过 `npx --yes spec-nfc@latest` 直接试用

### 当前公开能力
- 项目协议接入：`init / add / upgrade`
- change 协作对象：`create / check / stage / archive`
- integration 协作对象：多人接口 / service 对接与对齐
- 仓级状态与协议校验：`status / doctor / explain`
- 中文 skill-pack、多工具入口投影、公开示例与样例 dossier

### 当前边界
- 当前版本聚焦仓内协议控制面与团队协作主链路，不包含重型运行时编排平台
- 当前不绑定单一 AI 工具或单一托管环境
- 当前不提供外部向量库式团队长期记忆服务，仍以仓内协议与索引为主

---

## v3.1.0 - 2026-04-18

结构收敛与文档减负版本。

### 新增
- 将 change 文档收敛为四主文档结构
- 引入对“中高复杂度 / 涉及架构取舍 / 涉及技术选型”的技术设计与选型分流
- 增强升级迁移能力，支持旧结构自动合并与清理

### 强化
- 文档命名按工作流顺序增加序号前缀，提升可读性
- 索引结构在文档合并后继续保持稳定，不因文件收敛而失效
- Git 排除规则补强，不要求共享的过程文件默认不进入版本控制

---

## v3.0.0 - 2026-04-16

`spec-nfc` 的协议重构版本。

### 新增
- 形成 `.specnfc/` 作为仓内 canonical control plane 的统一定义
- 形成 `.nfc/` 作为运行时与协作层的统一定义
- 建立 change / integration / project 多层对象、阶段机、文档合同与治理模式骨架
- 引入中文 skill-pack 与多工具入口投影统一机制

### 强化
- `status` 升级为仓级控制面看板
- `doctor` 升级为协议一致性检查器
- `init` 从简单初始化提升为项目协议接入动作
- `upgrade` 强化为面向旧仓迁移的保守升级器

### 当前意义
- 从“仓内模板工具”升级为“项目级 Spec-driven Coding 协议系统”
- 为公开发布、团队推广与跨工具协作奠定统一结构基础
