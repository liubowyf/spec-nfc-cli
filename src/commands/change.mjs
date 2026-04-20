import path from "node:path";
import {
  buildNextStepProtocolItems,
  buildWorkflowContractHealthSummary,
  formatGovernanceInlineSummary,
  translatePhase,
  translateStage
} from "../cli/contract-formatters.mjs";
import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { getRepoPaths, resolveRepoRoot } from "../kernel/paths.mjs";
import { pathExists } from "../utils/fs.mjs";
import { buildCommandNextStep } from "./next-step.mjs";
import {
  archiveChange,
  CHANGE_STAGES,
  createChange,
  generateChangeHandoff,
  getSupportedChangeStageInputs,
  inspectChanges,
  normalizeChangeStageInput,
  listChanges,
  normalizeChangeId,
  updateChangeStage
} from "../workflow/changes.mjs";

export async function runChange({ args, flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const action = args[0];

  if (!action) {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "未提供 change 子命令",
      next: [
        "支持的子命令：create、list、check、stage、handoff、archive",
        "示例：`specnfc change create risk-device-link --title \"设备关联风险识别增强\"`"
      ]
    });
  }

  if (!(await isInitialized(repoRoot))) {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "NOT_INITIALIZED",
      message: "当前仓库尚未初始化，请先运行 `specnfc init`",
      next: ["运行 `specnfc init --with context,execution,governance`"]
    });
  }

  if (action === "create") {
    return runCreateChange({ repoRoot, args, flags });
  }

  if (action === "list") {
    return runListChanges({ repoRoot });
  }

  if (action === "check") {
    return runCheckChanges({ repoRoot, args });
  }

  if (action === "stage") {
    return runStageChange({ repoRoot, args, flags });
  }

  if (action === "handoff") {
    return runHandoffChange({ repoRoot, args, flags });
  }

  if (action === "archive") {
    return runArchiveChange({ repoRoot, args, flags });
  }

  return createErrorResult({
    command: "change",
    cwd: repoRoot,
    code: "INVALID_ARGS",
    message: `未识别的 change 子命令：${action}`,
    next: ["支持的子命令：create、list、check、stage、handoff、archive", "运行 `specnfc change --help` 查看说明"]
  });
}

async function runCreateChange({ repoRoot, args, flags }) {
  const rawChangeId = args[1];
  if (!rawChangeId) {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "未提供 change-id",
      next: ["示例：`specnfc change create risk-device-link --title \"设备关联风险识别增强\"`"]
    });
  }

  const changeId = normalizeChangeId(rawChangeId);
  if (!changeId) {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "change-id 不合法，请使用英文、数字和短横线",
      next: ["示例：`specnfc change create risk-device-link`"]
    });
  }

  const repoPaths = getRepoPaths(repoRoot);
  const changeRoot = path.join(repoPaths.changesRoot, changeId);
  if ((await pathExists(changeRoot)) && !flags.force) {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "PATH_CONFLICT",
      message: `change 已存在：${changeId}`,
      next: ["如需覆盖标准文件，运行 `specnfc change create <change-id> --force`"]
    });
  }

  let result;
  try {
    result = await createChange({
      repoRoot,
      rawChangeId: changeId,
      title: flags.title,
      type: flags.type || "feature",
      dryRun: Boolean(flags.dryRun)
    });
  } catch (error) {
    const handled = toChangeLifecycleErrorResult({ repoRoot, error, changeId });
    if (handled) {
      return handled;
    }
    throw error;
  }

  return createSuccessResult({
    command: "change",
    cwd: repoRoot,
    data: {
      action: "create",
      change: result,
      nextStep: buildCommandNextStep({
        currentPhase: result.canonicalStage,
        step: "clarify_requirements",
        stepLabel: "先完成需求与方案",
        primaryAction: "补充 01-需求与方案.md",
        primaryDoc: "01-需求与方案.md",
        primaryGoal: "先把问题定义、目标/非目标、范围、当前选择与验收口径写清楚。",
        requiredSections: ["问题定义", "目标", "非目标", "范围", "当前选择", "风险与验收口径"],
        doNotDoYet: [
          "不要先维护 `03-任务计划与执行.md`",
          "不要直接进入代码实现或测试",
          "不要先补 `04-验收与交接.md`"
        ],
        exitCriteria: [
          "`01-需求与方案.md` 已补齐关键章节",
          `重新运行 \`specnfc change check ${result.changeId}\` 后获取下一步分流`
        ],
        afterPrimaryAction: `补完 01 后，运行 \`specnfc change check ${result.changeId}\``,
        completed: ["change dossier 已创建"],
        recommendedNext: [
          { type: "doc", value: "01-需求与方案.md" },
          { type: "cli", value: `specnfc change check ${result.changeId}` },
          { type: "skill", value: "需求澄清" }
        ],
        stepAware: true
      }),
      dryRun: Boolean(flags.dryRun)
    },
    human: {
      summary: flags.dryRun ? "已生成 change 创建预览。" : "已创建 change。",
      sections: [
        {
          title: "当前推进主链路",
          items: [
            "当前阶段：需求澄清",
            "当前步骤：先完成需求与方案",
            "当前主动作：补充 `01-需求与方案.md`",
            "当前不该做：不要先维护 03，也不要直接进入代码实现",
            `完成后下一步：运行 \`specnfc change check ${result.changeId}\``
          ]
        },
        {
          title: "变更信息",
          items: [
            `ID：${result.changeId}`,
            `标题：${result.title}`,
            `类型：${result.type}`,
            `阶段：${result.stage}`
          ]
        },
        {
          title: flags.dryRun ? "计划创建" : "已创建",
          items: result.created
        }
      ]
    },
    warnings: [],
    next: [
      `先补 \`${result.changeRoot}/01-需求与方案.md\` 的问题定义、目标/非目标、范围、当前选择与验收口径`,
      `补完后运行 \`specnfc change check ${result.changeId}\``
    ]
  });
}

async function runListChanges({ repoRoot }) {
  const result = await listChanges({ repoRoot });
  const items = result.changes.map(
    (change) =>
      `${change.id}｜${change.title}｜${change.type}｜${change.stage}｜成熟度：${change.maturity?.summary || "未知"}｜交付：${change.delivery?.summary || "未启用"}｜动作：${change.delivery?.action || change.maturity?.action || "当前无"}`
  );

  return createSuccessResult({
    command: "change",
    cwd: repoRoot,
    data: {
      action: "list",
      changes: result.changes,
      risks: result.risks
    },
    human: {
      summary: result.changes.length ? "当前 change 清单" : "当前无进行中的 change。",
      sections: result.changes.length
        ? [
            {
              title: "变更列表",
              items
            }
          ]
        : []
    },
    warnings: result.risks.map((item) => `${item.code}：${item.message}`),
    next: result.changes.length ? ["运行 `specnfc change check` 检查全部 change"] : ["运行 `specnfc change create <change-id>` 创建第一项 change"]
  });
}

async function runCheckChanges({ repoRoot, args }) {
  const rawChangeId = args[1];
  const normalized = rawChangeId ? normalizeChangeId(rawChangeId) : null;

  if (rawChangeId && !normalized) {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "change-id 不合法，请使用英文、数字和短横线",
      next: ["示例：`specnfc change check risk-device-link`"]
    });
  }

  const report = await inspectChanges({
    repoRoot,
    rawChangeId: normalized
  });

  if (normalized && !report.changes.length) {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: `未找到 change：${normalized}`,
      next: ["运行 `specnfc change list` 查看当前 change"]
    });
  }

  const hasIssues = Boolean(report.missing.length || report.risks.length || (report.nextStep?.blocking?.length ?? 0));
  const next = buildChangeCheckNext(report);
  const writebackTargets = report.changes.length
    ? Array.from(new Set(report.changes.flatMap((change) => change.writeback?.targetDocs || [])))
    : [];
  const contractHealthSummary = buildWorkflowContractHealthSummary({
    controlPlaneStatus: report.runtimeRules ? "规则已加载" : "当前无",
    blockerCount: Math.max(report.blocking?.length ?? 0, report.nextStep?.blocking?.length ?? 0),
    advisoryCount: report.advisory?.length ?? 0,
    currentPhase: report.nextStep?.currentPhase,
    writebackCount: report.changes.reduce((sum, change) => sum + (change.writeback?.count ?? 0), 0),
    recommendedFocus: next,
    projectionDrift: report.nextStep?.projectionDrift,
    skillPackDrift: report.nextStep?.skillPackDrift,
    generatedAt: report.nextStep?.updatedAt
  });

  return createSuccessResult({
    command: "change",
    cwd: repoRoot,
    data: {
      action: "check",
      ...report,
      contractHealthSummary
    },
    human: {
      summary: hasIssues ? "变更存在需处理项。" : "变更检查通过。",
      sections: [
        {
          title: "当前推进主链路",
          items: buildChangePrimaryActionItems(report.nextStep)
        },
        {
          title: "协议合同健康摘要",
          items: [
            `综合状态：${contractHealthSummary.overallStatus}`,
            `规则状态：${contractHealthSummary.controlPlaneStatus}`,
            `合规等级：${contractHealthSummary.complianceLevel}`,
            `当前阶段：${contractHealthSummary.currentPhase}`,
            `写回状态：${contractHealthSummary.writebackStatus}`,
            `投影状态：${contractHealthSummary.projectionStatus}`,
            `技能包状态：${contractHealthSummary.skillPackStatus}`,
            `阻塞项：${contractHealthSummary.blockerCount}`,
            `提示项：${contractHealthSummary.advisoryCount}`,
            `建议聚焦：${contractHealthSummary.recommendedFocus.join("；") || "当前无"}`
          ]
        },
        {
          title: "变更状态",
          items: report.changes.length
            ? report.changes.map((change) => `${change.id}｜${change.title}｜${change.type}｜${translateStage(change.stage)}｜成熟度：${change.maturity?.summary || "未知"}｜交付：${change.delivery?.summary || "未启用"}｜动作：${change.delivery?.action || change.maturity?.action || "当前无"}`)
            : ["当前无"]
        },
        {
          title: "治理摘要",
          items: report.changes.length
            ? report.changes.map(
                (change) =>
                  `${change.id}｜评审：${change.governance?.recordCounts?.review ?? 0}｜审批：${change.governance?.recordCounts?.approval ?? 0}｜验证：${change.governance?.recordCounts?.verification ?? 0}｜${formatGovernanceInlineSummary(change.governance)}`
              )
            : ["当前无"]
        },
        {
          title: "下一步协议",
          items: buildNextStepProtocolItems(report.nextStep)
        },
        {
          title: "正常项",
          items: report.healthy.length ? report.healthy : ["当前无"]
        },
        {
          title: "缺失项",
          items: report.missing.length ? report.missing : ["当前无"]
        },
        {
          title: "风险项",
          items: report.risks.length ? report.risks.map((item) => `${item.code}：${item.message}`) : ["当前无"]
        },
        {
          title: "待回写文档",
          items: writebackTargets.length ? writebackTargets : ["当前无"]
        }
      ]
    },
    warnings: [],
    next
  });
}

function buildChangeCheckNext(report) {
  if (report.nextStep) {
    const next = [];
    if (report.nextStep.primaryAction) {
      next.push(`当前先做：${report.nextStep.primaryAction}`);
    }
    if (report.nextStep.primaryDoc) {
      next.push(`当前文档：\`${report.nextStep.primaryDoc}\``);
    }
    if ((report.nextStep.doNotDoYet || []).length) {
      next.push(`当前不该做：${report.nextStep.doNotDoYet.join("；")}`);
    }
    if (report.nextStep.afterPrimaryAction) {
      next.push(`完成后下一步：${report.nextStep.afterPrimaryAction}`);
    }
    if (next.length) {
      return next;
    }
  }

  const next = ["补齐缺失文件或修复元信息后重新运行 `specnfc change check`"];
  const gapCodes = new Set();
  const mergedRiskCodes = new Set([
    "PLACEHOLDER_REQUIREMENTS_AND_SOLUTION",
    "PLACEHOLDER_TECHNICAL_DESIGN",
    "PLACEHOLDER_PLAN_AND_EXECUTION",
    "PLACEHOLDER_ACCEPTANCE_AND_HANDOFF"
  ]);

  for (const change of report.changes ?? []) {
    if (change?.delivery?.action && change.delivery.action !== "当前无") {
      next.push(`${change.id}：${change.delivery.action}`);
    }

    for (const gap of change?.maturity?.gaps || []) {
      if (gap?.code) {
        gapCodes.add(gap.code);
      }
    }
  }

  const riskCodes = new Set((report.risks || []).map((item) => item.code));
  const prefersMergedDocs =
    (report.changes || []).some((change) => Boolean(change?.docRoles)) ||
    Array.from(mergedRiskCodes).some((code) => riskCodes.has(code));

  if (gapCodes.has("MISSING_REQUIREMENTS_SCOPE") || gapCodes.has("MISSING_REQUIREMENTS_ACCEPTANCE")) {
    next.push("先补 `01-需求与方案.md` 的范围和验收口径");
  } else if (riskCodes.has("PLACEHOLDER_REQUIREMENTS_AND_SOLUTION")) {
    next.push("先补 `01-需求与方案.md` 的问题定义、方案选择与验收口径");
  }
  if (gapCodes.has("MISSING_TECHNICAL_CONSTRAINTS") || gapCodes.has("MISSING_TECHNICAL_OPTIONS")) {
    next.push("先补 `02-技术设计与选型.md` 的约束、候选方案与选型结论");
  } else if (riskCodes.has("PLACEHOLDER_TECHNICAL_DESIGN")) {
    next.push("先补 `02-技术设计与选型.md` 的候选方案对比和技术结论");
  }
  if (gapCodes.has("MISSING_EXECUTION_STATUS") || gapCodes.has("MISSING_EXECUTION_NEXT")) {
    next.push("先补 `03-任务计划与执行.md` 的状态与下一步");
  } else if (riskCodes.has("PLACEHOLDER_PLAN_AND_EXECUTION")) {
    next.push("先补 `03-任务计划与执行.md` 的任务拆分、执行状态与推进动作");
  }
  if (riskCodes.has("PLACEHOLDER_ACCEPTANCE_AND_HANDOFF")) {
    next.push("先补 `04-验收与交接.md` 的验收结果、交接说明与提交说明");
  }
  if (!prefersMergedDocs) {
    if (gapCodes.has("MISSING_SPEC_SCOPE") || gapCodes.has("MISSING_SPEC_ACCEPTANCE")) {
      next.push("先补 `spec.md` 的范围和验收标准");
    } else if (riskCodes.has("PLACEHOLDER_SPEC")) {
      next.push("先补 `spec.md` 的背景、目标、范围和验收");
    }
    if (gapCodes.has("MISSING_DESIGN_CONSTRAINTS") || gapCodes.has("MISSING_DESIGN_VERIFICATION")) {
      next.push("先补 `design.md` 的边界与约束和验证思路");
    }
    if (gapCodes.has("MISSING_PLAN_RISKS") || gapCodes.has("MISSING_PLAN_VALIDATION")) {
      next.push("先补 `plan.md` 的关键风险和验证计划");
    } else if (riskCodes.has("PLACEHOLDER_PLAN")) {
      next.push("先补 `plan.md` 的技术方案、约束和验证计划");
    }
    if (riskCodes.has("PLACEHOLDER_CAPABILITIES")) {
      next.push("先补 `capabilities.md` 的能力影响");
    }
    if (riskCodes.has("PLACEHOLDER_SPEC_DELTAS")) {
      next.push("先补 `spec-deltas.md` 的规格增量");
    }
    if (riskCodes.has("PLACEHOLDER_DECISIONS")) {
      next.push("先补 `decisions.md` 的已确认决策");
    }
    if (riskCodes.has("PLACEHOLDER_STATUS")) {
      next.push("先补 `status.md` 的当前结论和下一步");
    }
  }
  if (riskCodes.has("INVALID_GOVERNANCE_RECORDS")) {
    next.push("先修复无效 governance record（JSON / scope / target / 引用）");
    next.push("运行 `specnfc doctor --json` 查看无效治理摘要");
  }

  return Array.from(new Set(next));
}

function buildChangePrimaryActionItems(protocol) {
  if (!protocol) {
    return ["当前无"];
  }

  const items = [
    `当前阶段：${translatePhase(protocol.currentPhase)}`,
    `当前步骤：${protocol.stepLabel || protocol.step || "当前无"}`,
    `当前主动作：${protocol.primaryAction || "当前无"}`,
    `当前文档：${protocol.primaryDoc ? `\`${protocol.primaryDoc}\`` : "当前无"}`,
    `当前需补章节：${protocol.requiredSections?.join("、") || "当前无"}`,
    `当前不该做：${protocol.doNotDoYet?.join("；") || "当前无"}`,
    `完成条件：${protocol.exitCriteria?.join("；") || "当前无"}`,
    `完成后下一步：${protocol.afterPrimaryAction || "当前无"}`
  ];

  if (protocol.interviewRound != null) {
    items.push(`当前轮次：第 ${protocol.interviewRound} 轮`);
  }
  if (protocol.interviewTarget) {
    items.push(`当前聚焦：${protocol.interviewTarget}`);
  }
  if (typeof protocol.ambiguityPercent === "number") {
    items.push(`当前歧义：${protocol.ambiguityPercent}%`);
  }
  if ((protocol.confirmedFacts || []).length) {
    items.push(`已确认：${protocol.confirmedFacts.join("；")}`);
  }
  if ((protocol.readinessGates || []).length) {
    items.push(
      `Readiness Gates：${protocol.readinessGates
        .map((item) => {
          if (typeof item === "string") {
            return item;
          }
          return `${item.name || item.label || "当前无"}=${translateReadinessGateStatus(item.status)}`;
        })
        .join("；")}`
    );
  }
  if (protocol.focusQuestion) {
    items.push(`本轮关键问题：${protocol.focusQuestion}`);
  }
  if ((protocol.writebackSections || []).length) {
    items.push(`本轮写回章节：${protocol.writebackSections.join("、")}`);
  }

  return items;
}

function translateReadinessGateStatus(status) {
  switch (status) {
    case "complete":
      return "已完成";
    case "focus":
      return "当前聚焦";
    case "pending":
      return "待补齐";
    case "blocked":
      return "阻断";
    default:
      return "未知";
  }
}

async function runStageChange({ repoRoot, args, flags }) {
  const rawChangeId = args[1];
  const changeId = normalizeChangeId(rawChangeId);
  const toStage = normalizeChangeStageInput(flags.to);

  if (!changeId) {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "未提供合法的 change-id",
      next: ["示例：`specnfc change stage risk-device-link --to design`"]
    });
  }

  if (!CHANGE_STAGES.includes(toStage)) {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: `未识别的阶段：${toStage || "空值"}`,
      next: [`支持的阶段：${getSupportedChangeStageInputs().join("、")}`]
    });
  }

  try {
    const result = await updateChangeStage({
      repoRoot,
      rawChangeId: changeId,
      toStage
    });

    return createSuccessResult({
      command: "change",
      cwd: repoRoot,
      data: {
        action: "stage",
        change: result,
        nextStep: buildCommandNextStep({
          currentPhase: result.canonicalStage,
          completed: [`change 已进入 ${result.canonicalStage}`],
          recommendedNext: [{ type: "cli", value: `specnfc change check ${result.changeId}` }]
        })
      },
      human: {
        summary: "已更新 change 阶段。",
        sections: [
          {
            title: "变更信息",
            items: [
              `ID：${result.changeId}`,
              `标题：${result.title}`,
              `类型：${result.type}`,
              `当前阶段：${result.stage}`
            ]
          }
        ]
      },
      warnings: [],
      next: ["进入交接前，运行 `specnfc change handoff <change-id>` 进行交接检查"]
    });
  } catch (error) {
    const handled = toChangeLifecycleErrorResult({ repoRoot, error, changeId });
    if (handled) {
      return handled;
    }

    throw error;
  }
}

async function runHandoffChange({ repoRoot, args, flags }) {
  const rawChangeId = args[1];
  const changeId = normalizeChangeId(rawChangeId);

  if (!changeId) {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "未提供合法的 change-id",
      next: ["示例：`specnfc change handoff risk-device-link`"]
    });
  }

  try {
    const result = await generateChangeHandoff({
      repoRoot,
      rawChangeId: changeId,
      force: Boolean(flags.force),
      dryRun: Boolean(flags.dryRun)
    });

    return createSuccessResult({
      command: "change",
      cwd: repoRoot,
      data: {
        action: "handoff",
        change: result,
        dryRun: Boolean(flags.dryRun)
      },
      human: {
        summary: flags.dryRun ? "已生成交接预览。" : "已完成交接检查。",
        sections: [
          {
            title: "变更信息",
            items: [
              `ID：${result.changeId}`,
              `标题：${result.title}`,
              `类型：${result.type}`,
              `当前阶段：${result.stage}`
            ]
          },
          {
            title: flags.dryRun ? "计划生成" : "已生成",
            items: [result.handoffPath]
          },
          {
            title: "交接摘要",
            items: result.handoffSummary?.summaryLines?.length ? result.handoffSummary.summaryLines : ["当前无"]
          },
          {
            title: "发布影响",
            items: result.handoffSummary?.impactLines?.length ? result.handoffSummary.impactLines : ["当前无"]
          },
          {
            title: "验证与交接状态",
            items: result.handoffSummary?.verificationLines?.length ? result.handoffSummary.verificationLines : ["当前无"]
          }
        ]
      },
      warnings: [],
      next: [
        "复核 `04-验收与交接.md` 内容并补充最终发布说明",
        "如已完成交接，可运行 `specnfc change archive <change-id>`"
      ]
    });
  } catch (error) {
    const handled = toChangeLifecycleErrorResult({ repoRoot, error, changeId });
    if (handled) {
      return handled;
    }

    if (error instanceof Error && error.message === "HANDOFF_EXISTS") {
      return createErrorResult({
        command: "change",
        cwd: repoRoot,
        code: "PATH_CONFLICT",
        message: `发布交接单已存在：${changeId}`,
        next: ["如需覆盖，运行 `specnfc change handoff <change-id> --force`"]
      });
    }

    throw error;
  }
}

async function runArchiveChange({ repoRoot, args, flags }) {
  const rawChangeId = args[1];
  const changeId = normalizeChangeId(rawChangeId);

  if (!changeId) {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "未提供合法的 change-id",
      next: ["示例：`specnfc change archive risk-device-link`"]
    });
  }

  try {
    const result = await archiveChange({
      repoRoot,
      rawChangeId: changeId,
      force: Boolean(flags.force),
      dryRun: Boolean(flags.dryRun)
    });

    return createSuccessResult({
      command: "change",
      cwd: repoRoot,
      data: {
        action: "archive",
        change: result,
        dryRun: Boolean(flags.dryRun)
      },
      human: {
        summary: flags.dryRun ? "已生成归档预览。" : "已归档 change。",
        sections: [
          {
            title: "变更信息",
            items: [
              `ID：${result.changeId}`,
              `标题：${result.title}`,
              `类型：${result.type}`,
              `当前阶段：${result.stage}`
            ]
          },
          {
            title: flags.dryRun ? "计划归档到" : "已归档到",
            items: [result.archivePath]
          }
        ]
      },
      warnings: [],
      next: ["如需查看归档结果，请检查 `specs/archive/`"]
    });
  } catch (error) {
    const handled = toChangeLifecycleErrorResult({ repoRoot, error, changeId });
    if (handled) {
      return handled;
    }

    if (error instanceof Error && error.message === "ARCHIVE_EXISTS") {
      return createErrorResult({
        command: "change",
        cwd: repoRoot,
        code: "PATH_CONFLICT",
        message: `归档目标已存在：${changeId}`,
        next: ["如需覆盖，先清理目标目录后重试"]
      });
    }

    throw error;
  }
}

function toChangeLifecycleErrorResult({ repoRoot, error, changeId }) {
  if (!(error instanceof Error) || !("code" in error)) {
    return null;
  }

  if (error.code === "CHANGE_NOT_FOUND") {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "CHANGE_NOT_FOUND",
      message: error.message,
      next: ["运行 `specnfc change list` 查看当前 change", `确认 \`${changeId}\` 是否已创建且目录存在`]
    });
  }

  if (error.code === "PRECONDITION_FAILED") {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "PRECONDITION_FAILED",
      message: error.message,
      next: [
        error.message.includes("in-progress")
          ? "先运行 `specnfc integration check` 修复对接状态，再重试阶段推进"
          : "补齐前置文件或状态后重试"
      ]
    });
  }

  if (error.code === "WRITE_DENIED") {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "WRITE_DENIED",
      message: error.message,
      next: ["检查 change 目录、仓库边界和元信息是否被篡改"]
    });
  }

  if (error.code === "INVALID_CONFIG") {
    return createErrorResult({
      command: "change",
      cwd: repoRoot,
      code: "INVALID_CONFIG",
      message: error.message,
      next: [
        "先运行 `specnfc upgrade` 修正仓内协议结构",
        "或手动检查 `.specnfc/config.json` 中的 `defaults.changeStructure` 是否仍为旧版结构"
      ]
    });
  }

  return null;
}
