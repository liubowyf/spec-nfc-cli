import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import {
  buildNextStepProtocolItems,
  buildWorkflowContractHealthSummary,
  formatGovernanceInlineSummary,
  translateStage
} from "../cli/contract-formatters.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { parseModuleList } from "../kernel/modules.mjs";
import { resolveRepoRoot } from "../kernel/paths.mjs";
import { buildCommandNextStep } from "./next-step.mjs";
import {
  createIntegration,
  getSupportedIntegrationStageInputs,
  inspectIntegrations,
  INTEGRATION_STATES,
  listIntegrations,
  normalizeIntegrationId,
  normalizeIntegrationStageInput,
  updateIntegrationStage
} from "../workflow/integrations.mjs";

export async function runIntegration({ args, flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const action = args[0];

  if (!action) {
    return createErrorResult({
      command: "integration",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "未提供 integration 子命令",
      next: ["支持的子命令：create、list、check、stage"]
    });
  }

  if (!(await isInitialized(repoRoot))) {
    return createErrorResult({
      command: "integration",
      cwd: repoRoot,
      code: "NOT_INITIALIZED",
      message: "当前仓库尚未初始化，请先运行 `specnfc init`",
      next: ["运行 `specnfc init --profile enterprise` 或 `specnfc init --with integration-contract`"]
    });
  }

  if (action === "create") return runCreateIntegration({ repoRoot, args, flags });
  if (action === "list") return runListIntegrations({ repoRoot });
  if (action === "check") return runCheckIntegrations({ repoRoot, args });
  if (action === "stage") return runStageIntegration({ repoRoot, args, flags });

  return createErrorResult({
    command: "integration",
    cwd: repoRoot,
    code: "INVALID_ARGS",
    message: `未识别的 integration 子命令：${action}`,
    next: ["支持的子命令：create、list、check、stage"]
  });
}

async function runCreateIntegration({ repoRoot, args, flags }) {
  const rawIntegrationId = args[1];
  const integrationId = normalizeIntegrationId(rawIntegrationId);
  const provider = String(flags.provider || "").trim();
  const consumers = parseModuleList(flags.consumer || flags.consumers);
  const changes = parseModuleList(flags.changes);

  if (!integrationId) {
    return createErrorResult({ command: "integration", cwd: repoRoot, code: "INVALID_ARGS", message: "未提供合法的 integration-id", next: ["示例：`specnfc integration create account-risk-api --provider risk-engine --consumer account-service --changes risk-score-upgrade`"] });
  }
  if (!provider) {
    return createErrorResult({ command: "integration", cwd: repoRoot, code: "INVALID_ARGS", message: "未提供 provider", next: ["示例：`--provider risk-engine`"] });
  }
  if (!consumers.length) {
    return createErrorResult({ command: "integration", cwd: repoRoot, code: "INVALID_ARGS", message: "未提供 consumer", next: ["示例：`--consumer account-service`"] });
  }
  if (!changes.length) {
    return createErrorResult({ command: "integration", cwd: repoRoot, code: "INVALID_ARGS", message: "未提供 changes", next: ["示例：`--changes risk-score-upgrade,account-link-alert`"] });
  }

  const result = await createIntegration({ repoRoot, rawIntegrationId: integrationId, provider, consumers, changes, dryRun: Boolean(flags.dryRun) });
  return createSuccessResult({
    command: "integration",
    cwd: repoRoot,
    data: {
      action: "create",
      integration: result,
      nextStep: buildCommandNextStep({
        currentPhase: result.canonicalStage,
        completed: ["integration dossier 已创建"],
        recommendedNext: [
          { type: "cli", value: `specnfc integration check ${result.id}` },
          { type: "skill", value: "集成对齐" }
        ]
      }),
      dryRun: Boolean(flags.dryRun)
    },
    human: {
      summary: flags.dryRun ? "已生成对接创建预览。" : "已创建对接关系。",
      sections: [
        { title: "对接信息", items: [`ID：${result.id}`, `提供方：${result.provider}`, `消费方：${result.consumers.join("、")}`, `关联 change：${result.changes.join("、")}`, `状态：${result.status}`] },
        { title: flags.dryRun ? "计划创建" : "已创建", items: result.created }
      ]
    },
    next: [`运行 \`specnfc integration check ${result.id}\``, `补充 \`specs/integrations/${result.id}/contract.md\` 与 \`status.md\``]
  });
}

async function runListIntegrations({ repoRoot }) {
  const result = await listIntegrations({ repoRoot });
  return createSuccessResult({
    command: "integration",
    cwd: repoRoot,
    data: { action: "list", integrations: result.integrations, risks: result.risks },
    human: {
      summary: result.integrations.length ? "当前对接关系清单" : "当前无对接关系。",
      sections: result.integrations.length
        ? [{ title: "对接列表", items: result.integrations.map((item) => `${item.id}｜${item.provider} -> ${item.consumers.join("、")}｜${item.status}｜${item.summary}｜动作：${item.action}`) }]
        : []
    },
    warnings: result.risks.map((item) => `${item.code}：${item.message}`),
    next: result.integrations.length ? ["运行 `specnfc integration check` 检查全部对接"] : ["运行 `specnfc integration create <integration-id>` 创建第一条对接"]
  });
}

async function runCheckIntegrations({ repoRoot, args }) {
  const rawIntegrationId = args[1];
  const integrationId = rawIntegrationId ? normalizeIntegrationId(rawIntegrationId) : null;

  if (rawIntegrationId && !integrationId) {
    return createErrorResult({
      command: "integration",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "integration-id 不合法，请使用英文、数字和短横线",
      next: ["示例：`specnfc integration check account-risk-api`"]
    });
  }

  const report = await inspectIntegrations({ repoRoot, rawIntegrationId: integrationId });
  if (integrationId && !report.integrations.length) {
    return createErrorResult({ command: "integration", cwd: repoRoot, code: "INVALID_ARGS", message: `未找到对接：${integrationId}`, next: ["运行 `specnfc integration list` 查看当前对接"] });
  }

  const hasIssues = Boolean(report.missing.length || report.risks.length || (report.nextStep?.blocking?.length ?? 0));
  const next = hasIssues ? buildIntegrationCheckNext(report) : ["如契约已确认，可运行 `specnfc integration stage <integration-id> --to aligned`"];
  const writebackTargets = report.integrations.length
    ? Array.from(new Set(report.integrations.flatMap((item) => item.writeback?.targetDocs || [])))
    : [];
  const contractHealthSummary = buildWorkflowContractHealthSummary({
    controlPlaneStatus: report.runtimeRules ? "规则已加载" : "当前无",
    blockerCount: Math.max(report.blocking?.length ?? 0, report.nextStep?.blocking?.length ?? 0),
    advisoryCount: report.advisory?.length ?? 0,
    currentPhase: report.nextStep?.currentPhase,
    writebackCount: report.integrations.reduce((sum, item) => sum + (item.writeback?.count ?? 0), 0),
    recommendedFocus: next,
    projectionDrift: report.nextStep?.projectionDrift,
    skillPackDrift: report.nextStep?.skillPackDrift,
    generatedAt: report.nextStep?.updatedAt
  });

  return createSuccessResult({
    command: "integration",
    cwd: repoRoot,
    data: { action: "check", ...report, contractHealthSummary },
    human: {
      summary: hasIssues ? "对接存在需处理项。" : "对接检查通过。",
      sections: [
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
          title: "决策摘要",
          items: [
            `总数：${report.summary?.total ?? 0}`,
            `已就绪：${report.summary?.readyCount ?? 0}`,
            `已阻塞：${report.summary?.blockedCount ?? 0}`,
            `受影响变更：${report.summary?.affectedChanges?.join("、") || "当前无"}`
          ]
        },
        {
          title: "下一步协议",
          items: buildNextStepProtocolItems(report.nextStep)
        },
        {
          title: "治理摘要",
          items: report.integrations.length
            ? report.integrations.map(
                (item) =>
                  `${item.id}｜评审：${item.governance?.recordCounts?.review ?? 0}｜审批：${item.governance?.recordCounts?.approval ?? 0}｜验证：${item.governance?.recordCounts?.verification ?? 0}｜${formatGovernanceInlineSummary(item.governance)}`
              )
            : ["当前无"]
        },
        { title: "对接状态", items: report.integrations.length ? report.integrations.map((item) => `${item.id}｜${item.provider} -> ${item.consumers.join("、")}｜${translateStage(item.status)}｜动作：${item.action}`) : ["当前无"] },
        { title: "正常项", items: report.healthy.length ? report.healthy : ["当前无"] },
        { title: "缺失项", items: report.missing.length ? report.missing : ["当前无"] },
        { title: "风险项", items: report.risks.length ? report.risks.map((item) => `${item.code}：${item.message}`) : ["当前无"] },
        {
          title: "待回写文档",
          items: writebackTargets.length ? writebackTargets : ["当前无"]
        }
      ]
    },
    next
  });
}

function buildIntegrationCheckNext(report) {
  const next = ["补齐 contract.md / status.md 或修复治理记录后重新运行 `specnfc integration check`"];
  const riskCodes = new Set((report.risks || []).map((item) => item.code));

  if (riskCodes.has("PLACEHOLDER_INTEGRATION_CONTRACT")) {
    next.push("先补 `contract.md` 的接口约束、依赖和联调约定");
  }
  if (riskCodes.has("PLACEHOLDER_INTEGRATION_STATUS")) {
    next.push("先补 `status.md` 的当前结论、阻断项和验证状态");
  }
  if (riskCodes.has("PLACEHOLDER_INTEGRATION_DECISIONS")) {
    next.push("先补 `decisions.md` 的接口决策和兼容策略");
  }
  if (riskCodes.has("INVALID_GOVERNANCE_RECORDS")) {
    next.push("先修复无效 governance record（JSON / scope / target / 引用）");
    next.push("运行 `specnfc doctor --json` 查看无效治理摘要");
  }

  return Array.from(new Set(next));
}

async function runStageIntegration({ repoRoot, args, flags }) {
  const rawIntegrationId = args[1];
  const integrationId = normalizeIntegrationId(rawIntegrationId);
  const toState = normalizeIntegrationStageInput(flags.to);
  if (!integrationId) {
    return createErrorResult({ command: "integration", cwd: repoRoot, code: "INVALID_ARGS", message: "未提供合法的 integration-id", next: ["示例：`specnfc integration stage account-risk-api --to aligned`"] });
  }
  if (!INTEGRATION_STATES.includes(toState)) {
    return createErrorResult({ command: "integration", cwd: repoRoot, code: "INVALID_ARGS", message: `未识别的状态：${toState || "空值"}`, next: [`支持的状态：${getSupportedIntegrationStageInputs().join("、")}`] });
  }

  try {
    const result = await updateIntegrationStage({ repoRoot, rawIntegrationId: integrationId, toState });
    return createSuccessResult({
      command: "integration",
      cwd: repoRoot,
      data: {
        action: "stage",
        integration: result,
        nextStep: buildCommandNextStep({
          currentPhase: result.canonicalStage,
          completed: [`integration 已进入 ${result.canonicalStage}`],
          recommendedNext: [{ type: "cli", value: `specnfc integration check ${result.id}` }]
        })
      },
      human: {
        summary: "已更新对接状态。",
        sections: [{ title: "最新状态", items: [`ID：${result.id}`, `状态：${result.status}`, `更新时间：${result.updatedAt}`] }]
      },
      next: ["运行 `specnfc integration check` 复查对接状态"]
    });
  } catch (error) {
    if (error instanceof Error && "code" in error) {
      if (error.code === "INTEGRATION_NOT_FOUND") {
        return createErrorResult({
          command: "integration",
          cwd: repoRoot,
          code: "INTEGRATION_NOT_FOUND",
          message: error.message,
          next: ["运行 `specnfc integration list` 查看当前对接"]
        });
      }

      if (error.code === "INVALID_STAGE_TRANSITION" || error.code === "PRECONDITION_FAILED") {
        return createErrorResult({
          command: "integration",
          cwd: repoRoot,
          code: error.code,
          message: error.message,
          next: ["先补齐 contract.md / status.md，再重试状态推进"]
        });
      }

      if (error.code === "WRITE_DENIED") {
        return createErrorResult({
          command: "integration",
          cwd: repoRoot,
          code: "WRITE_DENIED",
          message: error.message,
          next: ["检查对接目录、仓库边界和元信息是否被篡改"]
        });
      }
    }

    throw error;
  }
}
