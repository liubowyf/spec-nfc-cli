import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { getPackageMeta } from "../kernel/meta.mjs";
import { expandModuleDependencies } from "../kernel/modules.mjs";
import { getProfile } from "../kernel/profiles.mjs";
import { resolvePathWithin, resolveRepoRoot } from "../kernel/paths.mjs";
import { installModules } from "../kernel/scaffold.mjs";
import { writeJson, writeText } from "../utils/fs.mjs";
import { createChange, generateChangeHandoff, updateChangeStage } from "../workflow/changes.mjs";

const DEMO_CHANGE_ID = "risk-device-link";
const DEMO_TITLE = "设备关联风险识别增强";

export async function runDemo({ flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);

  if ((await isInitialized(repoRoot)) && !flags.force) {
    return createErrorResult({
      command: "demo",
      cwd: repoRoot,
      code: "ALREADY_INITIALIZED",
      message: "目标目录已经初始化过，如需重建 demo 请显式传入 --force",
      next: ["如需覆盖生成，运行 `specnfc demo --force`"]
    });
  }

  const profile = getProfile("enterprise");
  const installed = await installModules({
    repoRoot,
    moduleNames: expandModuleDependencies(profile.modules),
    profileName: "enterprise",
    dryRun: Boolean(flags.dryRun),
    force: Boolean(flags.force)
  });

  const demoChange = await createChange({
    repoRoot,
    rawChangeId: DEMO_CHANGE_ID,
    title: DEMO_TITLE,
    type: "feature",
    dryRun: Boolean(flags.dryRun)
  });

  if (!flags.dryRun) {
    await applyDemoContent(repoRoot, demoChange.changeRoot);
    await updateChangeStage({
      repoRoot,
      rawChangeId: DEMO_CHANGE_ID,
      toStage: "verifying"
    });
    await generateChangeHandoff({
      repoRoot,
      rawChangeId: DEMO_CHANGE_ID
    });
  }

  return createSuccessResult({
    command: "demo",
    cwd: repoRoot,
    data: {
      profile: "enterprise",
      installedModules: installed.installedModules,
      demoChange: {
        id: DEMO_CHANGE_ID,
        title: DEMO_TITLE,
        stage: flags.dryRun ? "draft" : "handoff"
      },
      dryRun: Boolean(flags.dryRun)
    },
    human: {
      summary: flags.dryRun ? "已生成 demo 预览。" : "已生成完整企业示例仓。",
      sections: [
        {
          title: "初始化 Profile",
          items: ["enterprise"]
        },
        {
          title: "示例变更",
          items: [
            `ID：${DEMO_CHANGE_ID}`,
            `标题：${DEMO_TITLE}`,
            `阶段：${flags.dryRun ? "draft" : "handoff"}`
          ]
        },
        {
          title: flags.dryRun ? "计划生成" : "已生成",
          items: [
            ".specnfc/",
            "specs/changes/risk-device-link/",
            "specs/changes/risk-device-link/release-handoff.md"
          ]
        }
      ]
    },
    warnings: [],
    next: [
      "运行 `specnfc doctor` 检查示例仓状态",
      "阅读 `specs/changes/risk-device-link/` 下的完整示例文件"
    ]
  });
}

async function applyDemoContent(repoRoot, relativeChangeRoot) {
  const changeRoot = resolvePathWithin(repoRoot, relativeChangeRoot);
  const packageMeta = await getPackageMeta();
  const protocolVersion = packageMeta.version || "unknown";

  await writeText(
    resolvePathWithin(repoRoot, "specs/project/summary.md"),
    `# 项目汇总

## 项目标识
- 项目 ID：specnfc-demo-enterprise
- 团队标识：public-demo
- 协议版本：${protocolVersion}

## 协议概况
- 当前治理模式：guided
- 当前活跃 skill-pack：specnfc 默认中文 skill-pack
- 当前主阶段：accept

## 团队级上下文引用
- 来源索引：examples/public-demo
- 文档索引 / 摘要路径：specs/project/summary.md
- 最新 digest：demo-seed-2026-04-15

## 当前仓与模块
- 仓列表：当前示例仓 1 个
- 已启用模块：context、execution、governance、design-api、design-db、quality、delivery

## 活跃 Change 摘要
- 当前活跃 change：risk-device-link，已进入 handoff 阶段
- 最近完成 change：当前示例仅保留该 change 作为培训样板

## 活跃 Integration 摘要
- 当前活跃 integration：无
- 关键依赖 / 阻断：当前示例变更不依赖额外 integration

## 最近迭代结果
- 迭代结果摘要：完成设备关联风险识别能力的规格、计划、验收与交接演练
- 关键交付物：01-需求与方案、02-技术设计与选型、03-任务计划与执行、04-验收与交接
- 关键决策：选择在评分服务内直接落设备关联规则，保持示例链路最短

## 风险与阻断
- 当前风险：仅保留培训样例层面的数据延迟观察项，不构成阻断
- 当前阻断：无

## 下一步
- 推荐下一步：运行 \`specnfc change check risk-device-link\` 阅读完整样例，再创建团队真实 change
- 待补写回：无
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "01-需求与方案.md"),
    `# 需求与方案

## 问题定义

当前风险评分链路只能在单设备单账号视角下判断异常行为，无法快速识别同设备短时关联多账号的聚集风险，导致异常识别与响应滞后。

## 目标

- 在不改造旧调用主链路的前提下，为风险评分服务补充设备关联风险识别能力
- 将结果沉淀到统一事件记录中，方便发布、验收与后续追溯

## 范围

本次覆盖设备关联规则入库、风险评分结果字段补充、风险事件落库链路；不覆盖新模型训练和运营看板改造。

## 方案结论

本示例采用“在评分服务内直接落规则”的方案，理由是更适合演示一条 change 从需求到交付的最短闭环。

## 验收口径

设备关联规则可配置、评分接口可返回设备关联风险标签、风险事件落库链路可追溯，并且交接文档可直接被后续协作者继续使用。
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "02-技术设计与选型.md"),
    `# 技术设计与选型

## 设计目标

在评分链路内新增设备关联识别步骤，同时保持接口兼容、数据安全和灰度发布可控。

## 技术约束

- 兼容性：新字段必须可选返回
- 安全性：不得暴露明文设备标识
- 性能：评分链路新增耗时控制在 30ms 内
- 发布：仅允许灰度开启

## 候选路线

### 路线一：在评分服务内直接落规则

评分服务直接读取设备画像窗口数据，完成规则判断后返回设备关联风险标签。

### 路线二：拆分独立设备关联判定服务

边界更清晰，但示例仓接入成本更高，也会增加演示噪音。

## 选型结论

当前采用路线一。这样既能保持示例链路最短，也便于把设计、执行和交付集中在单条 change 中。
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "03-任务计划与执行.md"),
    `# 任务计划与执行

## 任务拆分

1. 补齐设备关联风险识别的需求与方案说明
2. 确认评分服务内落规则的技术设计与选型
3. 完成实现计划、执行状态和验证准备
4. 形成最终验收与交接结论

## 当前状态

当前结论：示例仓已完成一条从需求、设计、执行到交接的完整协议演练链路。

最近更新：已补齐关键文档、生成交接摘要，并准备作为公开示例阅读。

## 风险与验证

- 主要风险：设备行为数据延迟、索引设计导致的写入放大
- 当前验证：校验评分结果字段、事件落库和交接链路均可追溯

## 下一步

下一步动作：运行 \`specnfc change check risk-device-link\` 阅读完整示例，再创建实际 change。
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "04-验收与交接.md"),
    `# 验收与交接

## 验收范围

- 设备关联规则入库与启用
- 风险评分结果返回设备关联标签
- 风险事件落库与查询链路

## 验证方式与结果

- 单元测试：规则判断与边界数据
- 集成测试：风险评分接口和事件落库链路
- 手工验证：灰度环境抽样验证

## 剩余风险与结论

剩余风险：灰度发布时继续观察设备画像延迟；当前无阻断风险。

结论：已满足示例交接条件。是否允许进入 handoff / archive：是。

## 交付与发布交接

对外变更包括评分结果新增设备关联字段、风险事件表增加设备关联事件记录；发布时采用灰度开启。

## 提交说明

提交说明应聚焦设备关联风险识别这一单一意图，明确变更摘要、风险与验证结论。
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "proposal.md"),
    `# 需求提案

## 问题定义

当前风险评分链路只能在单设备单账号视角下判断异常行为，无法快速识别同设备短时关联多账号的聚集风险，导致异常识别与响应滞后。

## 目标

在不改造旧调用主链路的前提下，为风险评分服务补充设备关联风险识别能力，并把结果沉淀到统一事件记录中。

## 备选方案

### 方案 A：在评分服务内直接落规则

评分服务直接读取设备画像窗口数据，完成规则判断后返回设备关联风险标签。

### 方案 B：拆分独立设备关联判定服务

先独立做设备关联服务，再由评分服务聚合结果，边界更清晰，但示例仓接入成本更高。

## 最终决策

本示例采用方案 A。理由是它更适合演示“一条 change 从规格到交付”的最短闭环，同时不会引入额外服务编排噪音。

## 非目标

本次示例不覆盖新模型训练、不覆盖运营看板改造，也不追求展示复杂分布式拆分。
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "design.md"),
    `# 方案设计

## 技术结构

在风险评分服务中新增设备关联识别步骤，从设备画像服务获取近 24 小时行为，再输出设备关联风险标签并写入风险事件表。

## 关键接口与数据

- 输入来源：设备画像服务返回的近 24 小时行为窗口数据
- 输出结果：风险评分结果中的设备关联风险标签
- 状态落点：风险事件表中的设备关联事件记录
- 依赖关系：设备画像服务、风险评分服务、风险事件存储

## 边界与约束

- 兼容性要求：新字段必须可选返回
- 安全要求：不得暴露明文设备标识
- 性能要求：评分链路新增耗时控制在 30ms 内
- 发布要求：仅允许灰度开启

## 验证思路

- 设计成立的证明方式：校验评分结果字段、事件落库和交接链路均可追溯
- 重点验证风险：设备行为数据延迟、索引设计导致的写入放大
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "spec.md"),
    `# 变更规格

## 变更标识

- ID：\`${DEMO_CHANGE_ID}\`
- 标题：${DEMO_TITLE}
- 类型：\`feature\`

## 背景

现有设备关联识别仅基于单设备单账号视角，无法快速发现同设备多账号异常聚集行为，导致异常识别与响应滞后。

## 目标

在设备维度补充关联风险识别能力，对同设备短时多账号登录、注册、触达失败等行为形成统一风险判断。

## 范围

### 本次包含
- 设备关联规则入库
- 风险评分接口字段补充
- 风险事件落库与查询链路补充

### 本次不包含
- 新风控模型训练
- 新运营看板

## 验收标准

- [x] 设备关联规则可配置
- [x] 风险评分接口可返回设备关联风险标签
- [x] 风险事件落库链路可追溯
- [x] 发布交接单已生成

## 影响面

- 前端：风险详情页增加设备关联标签展示
- 后端：风险评分服务、事件服务、设备画像服务
- 接口契约：风险评分结果新增设备关联字段
- 数据结构：新增设备关联事件表及索引
- 测试：补齐单测、集成测试、发布验证
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "capabilities.md"),
    `# 能力影响

## 新增能力

- 新增设备关联风险识别能力
- 新增设备关联风险标签返回能力

## 调整能力

- 调整风险评分结果结构，增加设备关联字段

## 不受影响

- 不改变已有调用方必填字段
- 不改变已有风控模型训练流程

## 对外影响

- 接口：风险评分结果新增设备关联字段
- 数据：新增设备关联事件表
- 运营：风险详情页可展示设备关联标签
- 发布：灰度开启
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "spec-deltas.md"),
    `# 规格增量

## 本次新增

- 新增设备维度的关联风险规格
- 新增设备关联事件落库规格

## 本次修改

- 修改风险评分返回结构，补充设备关联字段

## 本次删除

- 当前无

## 兼容性说明

- 新字段以可选方式返回，不影响旧调用方
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "plan.md"),
    `# 实现计划

## 技术方案

在风险评分服务中新增设备关联识别步骤，从设备画像服务读取近 24 小时设备行为，按规则生成风险标签并返回给调用方，同时把最终判定写入风险事件表。

## 约束

- 兼容性要求：新字段必须向后兼容，旧调用方不受影响
- 性能要求：单次评分链路新增耗时不超过 30ms
- 安全要求：不得暴露明文设备标识
- 发布要求：仅允许灰度开启

## 改动分层

- 上下文层：补充设备关联术语和边界
- 执行层：实现 change 任务拆分和交接
- 治理层：补充发布关注点和回滚提示
- 业务实现：服务规则、接口契约、事件落库

## 关键风险

- 风险一：设备行为数据延迟导致误判
- 风险二：新索引设计不当导致写入放大

## 验证计划

- 单元验证覆盖规则判断与边界数据
- 集成验证覆盖风险评分接口和事件落库链路
- 手工验证覆盖灰度环境抽样检查
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "tasks.md"),
    `# 执行任务

## 任务清单

- [x] 完成 \`proposal.md\`
- [x] 完成 \`design.md\`
- [x] 完成 \`spec.md\`
- [x] 完成 \`plan.md\`
- [x] 补充接口详细设计
- [x] 补充数据库设计
- [x] 补齐测试策略和回归清单
- [x] 生成发布交接单

## Git 建议

- 使用单一 change 对应单一分支
- 保持提交严格整洁、少而稳
- 每次提交只覆盖一个清晰意图

## 推荐提交节奏

- feat: 新增设备关联风险识别规则
- feat: 补充评分接口返回字段
- test: 增加设备关联回归用例
- docs: 更新交接与设计文档
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "acceptance.md"),
    `# 验收记录

## 验收范围

- 设备关联规则入库与启用
- 风险评分结果返回设备关联标签
- 风险事件落库与查询链路

## 验证方式

- 单元测试：规则判断与边界数据
- 集成测试：风险评分接口和事件落库链路
- 手工验证：灰度环境抽样验证

## 测试 / 验证结果

- 结果 1：风险评分结果包含设备关联风险标签
- 结果 2：风险事件表可追溯设备关联事件

## 剩余风险

- 当前无阻断风险，灰度发布时继续观察设备画像延迟

## 结论

- 是否满足当前阶段要求：是
- 是否允许进入 accept / archive：是
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "decisions.md"),
    `# 决策记录

## 已确认决策

### 接口兼容策略

- 背景：需要在不破坏旧接口的前提下返回新风险结果
- 结论：通过新增可选字段返回设备关联风险信息
- 影响：调用方可以按需接入，不影响旧逻辑

### 事件落库策略

- 背景：设备关联行为查询量大
- 结论：通过事件表 + 组合索引支撑近 24 小时窗口查询
- 影响：需要提前评估写入成本与归档策略
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "status.md"),
    `# 当前状态

## 基本信息

- Change：\`${DEMO_CHANGE_ID}\`
- 标题：${DEMO_TITLE}
- 当前阶段：\`handoff\`

## 当前结论

当前示例仓已完成一条从规格、计划、任务、决策到交接单的完整演练链路，可直接用于团队培训和新人上手。

## 阻塞项

- 当前没有阻塞

## 下一步

- 阅读 \`release-handoff.md\`
- 运行 \`specnfc doctor\`
- 基于此示例创建团队真实 change
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "commit-message.md"),
    `# 提交说明草稿

\`\`\`text
feature: ${DEMO_CHANGE_ID} ${DEMO_TITLE}

Summary:
- 新增设备关联风险识别规则
- 新增评分接口返回字段

Risks:
- 设备行为数据延迟可能导致误判
- 新索引设计不当可能带来写入放大

Validation:
- 已补单元测试与集成测试计划
- 已生成发布交接单
\`\`\`
`
  );

  await writeText(
    resolvePathWithin(changeRoot, "delivery-checklist.md"),
    `# 交付自检

## 基本信息

- Change：\`${DEMO_CHANGE_ID}\`
- 标题：${DEMO_TITLE}
- 类型：\`feature\`
- 当前阶段：\`handoff\`

## 提交前

- [x] \`proposal / design / spec / capabilities / spec-deltas / plan / tasks / decisions / status\` 已同步
- [x] 本次提交只覆盖一个清晰意图
- [x] 已补验证结果

## 推送前

- [x] 当前分支与 \`change-id\` 对应正确
- [x] 风险与未完成项已写明
- [x] 如需他人继续接手，已在正式文件写明

## 交接前

- [x] 如需发布交接，\`release-handoff.md\` 已补齐
- [x] 下游不需要依赖聊天记录

## 归档前

- [ ] 当前变更已完成交付，可进入归档
`
  );

  await writeJson(resolvePathWithin(changeRoot, "evidence/reviews/design-review.json"), {
    recordId: "design-review",
    scope: "change",
    targetId: DEMO_CHANGE_ID,
    stage: "design",
    reviewType: "design",
    reviewer: "demo-architect",
    verdict: "approved",
    summary: "示例设计评审通过",
    evidenceRefs: [`${relativeChangeRoot}/design.md`],
    createdAt: "2026-04-15T08:00:00.000Z"
  });

  await writeJson(resolvePathWithin(changeRoot, "evidence/verifications/demo-qa-pass.json"), {
    recordId: "demo-qa-pass",
    scope: "change",
    targetId: DEMO_CHANGE_ID,
    stage: "verify",
    verificationType: "demo",
    executor: "demo-qa",
    result: "passed",
    evidenceRefs: [`${relativeChangeRoot}/acceptance.md`],
    summary: "示例验证通过",
    createdAt: "2026-04-15T08:05:00.000Z"
  });

  await writeJson(resolvePathWithin(changeRoot, "evidence/approvals/demo-handoff-approval.json"), {
    recordId: "demo-handoff-approval",
    scope: "change",
    targetId: DEMO_CHANGE_ID,
    stage: "accept",
    approvalType: "handoff",
    approver: "demo-tech-lead",
    decision: "approved",
    reviewRecordRefs: ["design-review"],
    verificationRecordRefs: ["demo-qa-pass"],
    createdAt: "2026-04-15T08:10:00.000Z"
  });
}
