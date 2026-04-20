# Spec nfc

`Spec nfc` 是一个面向团队协作与 AI Agent 落地的 **Spec-driven Coding 协议系统**。

它把“需求澄清 → 方案设计 → 任务计划 → 执行实现 → 验证验收 → 交付归档”固化为仓内可检查、可索引、可升级的协作协议，而不是只靠聊天记录或个人习惯推进开发。

## 适用场景

- 团队希望把需求、设计、执行、验收沉淀为正式文档与统一门禁
- 同一个项目需要同时接入 Codex、Claude Code、Trae、OpenCode 等不同 AI 工具
- 多人并行开发时，需要让 change / integration / status / doctor 成为统一协作语言
- 希望把个人工具使用自由保留，但把最终交付约束在同一套仓内协议上

## 核心能力

- **项目协议接管**：`specnfc init` 在目标仓生成 `.specnfc/`、`.nfc/`、`specs/` 三层结构
- **阶段化 change 流程**：按 `clarify → design → plan → execute → verify → accept → archive` 推进
- **integration 协作对象**：适合多人接口 / service 对接与联调门禁
- **统一入口投影**：自动生成 `AGENTS.md`、`CLAUDE.md`、`.trae/rules/project_rules.md`、`opencode.json`
- **控制面看板**：`specnfc status` 输出当前阶段、阻断、缺失文档、推荐下一步
- **协议一致性校验**：`specnfc doctor` 检查合同、索引、文档完整性、入口漂移与运行时回写
- **中文 skill pack 与提示体系**：把流程提示、文档回写、下一步建议统一到仓内协议
- **模板升级**：`specnfc upgrade` 以保守方式刷新受管文件并保留冲突提示

## 协议模型

初始化后的项目通常会看到三类对象：

- `.specnfc/`：仓内 **canonical control plane**，保存合同、索引、skill-pack、规则与投影策略
- `.nfc/`：运行时与协作层，承载访谈、计划、回写队列、会话状态与交接记录
- `specs/`：正式 dossier，保存 change / integration / project 级正式文档

常见正式对象：

- `specs/changes/<change-id>/`：单项变更 dossier
- `specs/integrations/<integration-id>/`：接口 / service 对接 dossier
- `specs/project/summary.md`：项目级摘要与长期索引入口

## 安装

### 全局安装

```bash
npm install -g spec-nfc
specnfc version
specnfc --help
```

### 直接试用

```bash
npx --yes spec-nfc@latest --help
npx --yes spec-nfc@latest version
```

### 从源码仓开发

```bash
npm install
npm test
node ./bin/specnfc.mjs --help
```

要求：`Node.js >= 20`

## 快速开始

### 1. 初始化项目协议

```bash
specnfc init --cwd /path/to/repo --profile enterprise
specnfc status --cwd /path/to/repo
```

### 2. 创建第一项 change

```bash
specnfc change create risk-device-link --cwd /path/to/repo --title "设备关联风险识别增强"
specnfc change check risk-device-link --cwd /path/to/repo
```

### 3. 按阶段补齐四主文档

默认合并后的主文档结构：

1. `01-需求与方案.md`
2. `02-技术设计与选型.md`
3. `03-任务计划与执行.md`
4. `04-验收与交接.md`

### 4. 存在接口 / service 依赖时创建 integration

```bash
specnfc integration create account-risk-api \
  --cwd /path/to/repo \
  --provider risk-engine \
  --consumer account-service \
  --changes risk-score-upgrade

specnfc integration check account-risk-api --cwd /path/to/repo
specnfc integration stage account-risk-api --cwd /path/to/repo --to aligned
```

## 命令总览

```bash
specnfc init
specnfc add
specnfc change
specnfc integration
specnfc status
specnfc doctor
specnfc explain
specnfc upgrade
specnfc demo
specnfc version
```

## 推荐协作节奏

```text
init
  ↓
status
  ↓
change create
  ↓
change check
  ↓
根据复杂度补文档与推进阶段
  ↓
存在对接依赖时创建 integration 并先对齐
  ↓
status / doctor 持续收口
```

`status` 与 `doctor` 的职责不同：

- `status`：告诉你 **现在最该做什么**
- `doctor`：告诉你 **哪里不一致、为什么不能继续、怎么修**

## 多工具 / 多 Agent 接入

`specnfc` 不绑定单一工具。

初始化后会生成统一入口投影：

- `AGENTS.md`
- `CLAUDE.md`
- `.trae/rules/project_rules.md`
- `opencode.json`

这意味着不同工具可以继续保留自己的工作方式，但最终都要回到同一套：

- 仓内合同
- 仓内索引
- change / integration dossier
- 文档门禁与下一步协议

## 公开示例

- 最小初始化示例：[`examples/minimal-init`](./examples/minimal-init)
- demo 输出示例：[`examples/demo-output`](./examples/demo-output)
- change 完整样例：[`specs/public-samples/change-full`](./specs/public-samples/change-full)
- integration 完整样例：[`specs/public-samples/integration-full`](./specs/public-samples/integration-full)

## 开发与验证

```bash
npm test
node ./scripts/pack-verify.mjs --json
```

如果你在开发发布面，重点检查：

- 公开 README / examples / specs 样例是否仍然准确
- `specnfc --help`、`specnfc explain install` 是否与公开安装路径一致
- `npm pack --dry-run --json` 是否没有把内部路径打进包内

## 贡献

贡献说明见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 安全

安全披露流程见 [SECURITY.md](./SECURITY.md)。

## 许可证

本项目使用 [MIT License](./LICENSE)。
