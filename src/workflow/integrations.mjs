import path from "node:path";
import { inspectGovernanceTarget } from "../kernel/governance-records.mjs";
import { readRepositoryGovernanceMode } from "../kernel/governance.mjs";
import { PROJECT_ROOT, getRepoPaths, resolvePathWithin } from "../kernel/paths.mjs";
import { buildActiveRules } from "../kernel/rules.mjs";
import { updateExecutionPointers } from "../kernel/execution-pointers.mjs";
import { updateRepositoryIndexes } from "../kernel/indexes.mjs";
import { filterWritebackQueue, inspectWritebackQueue, syncRuntimeLinksForRepo } from "../kernel/writeback.mjs";
import { assertPathInsideRoot, ensureDir, isDirectory, listDir, pathExists, readJson, readText, writeText } from "../utils/fs.mjs";
import { renderTemplate, toSlug } from "../utils/text.mjs";

export const INTEGRATION_STATES = ["draft", "aligned", "implementing", "integrating", "blocked", "done"];
const INTEGRATION_CANONICAL_PHASES = ["clarify", "plan", "execute", "verify", "accept"];
export const DEFAULT_INTEGRATION_FILES = ["meta.json", "contract.md", "decisions.md", "status.md", "runtime-links.json"];

const INTEGRATION_TEMPLATE_ROOT = path.join(PROJECT_ROOT, "src/workflow/templates/integration");

class IntegrationWorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "IntegrationWorkflowError";
    this.code = code;
  }
}

export function normalizeIntegrationId(rawIntegrationId) {
  return toSlug(String(rawIntegrationId ?? ""));
}

export async function createIntegration({ repoRoot, rawIntegrationId, provider, consumers, changes, dryRun = false }) {
  const integrationId = normalizeIntegrationId(rawIntegrationId);
  const repoPaths = getRepoPaths(repoRoot);
  const integrationRoot = resolvePathWithin(repoPaths.integrationsRoot, integrationId);
  await assertPathInsideRoot(repoRoot, integrationRoot);

  const now = new Date().toISOString();
  const context = {
    integrationId,
    provider,
    consumersJson: JSON.stringify(consumers),
    changesJson: JSON.stringify(changes),
    consumersText: consumers.join("、"),
    changesText: changes.join("、"),
    integrationStatus: "draft",
    integrationCanonicalStage: mapIntegrationStateToCanonical("draft"),
    createdAt: now,
    updatedAt: now
  };

  const created = [];
  if (!dryRun) {
    await ensureDir(integrationRoot);
    await ensureGovernanceEvidenceDirs(integrationRoot);
  }

  for (const relativeDir of getGovernanceEvidenceRelativeDirs()) {
    created.push(toRelative(repoRoot, path.join(integrationRoot, relativeDir)));
  }

  for (const fileName of DEFAULT_INTEGRATION_FILES) {
    const sourcePath = resolvePathWithin(INTEGRATION_TEMPLATE_ROOT, fileName);
    const targetPath = resolvePathWithin(integrationRoot, fileName);
    const rendered = renderTemplate(await readText(sourcePath), context);
    if (!dryRun) {
      await writeText(targetPath, rendered);
    }
    created.push(toRelative(repoRoot, targetPath));
  }

  if (!dryRun) {
    await updateExecutionPointers({
      repoRoot,
      integrationRef: {
        integrationId,
        path: toRelative(repoRoot, integrationRoot)
      },
      currentPhase: context.integrationCanonicalStage
    });
    await syncRuntimeLinksForRepo({ repoRoot });
    await updateRepositoryIndexes({ repoRoot });
  }

  return {
    id: integrationId,
    provider,
    consumers,
    changes,
    status: "draft",
    canonicalStage: mapIntegrationStateToCanonical("draft"),
    integrationRoot: toRelative(repoRoot, integrationRoot),
    created
  };
}

export async function listIntegrations({ repoRoot }) {
  const report = await inspectIntegrations({ repoRoot });
  return {
    integrations: report.integrations,
    risks: report.risks
  };
}

export async function inspectIntegrations({ repoRoot, rawIntegrationId }) {
  const repoPaths = getRepoPaths(repoRoot);
  const governanceMode = await readRepositoryGovernanceMode(repoRoot, "guided");
  const runtimeRules = await buildActiveRules({ repoRoot });
  const writebackQueue = await inspectWritebackQueue({ repoRoot });
  const healthy = [];
  const missing = [];
  const risks = [];
  const requestedId = rawIntegrationId ? normalizeIntegrationId(rawIntegrationId) : null;
  const integrationIds = requestedId ? [requestedId] : await getExistingIntegrationIds(repoPaths.integrationsRoot);
  const integrations = [];

  for (const integrationId of integrationIds) {
    const integrationRoot = resolvePathWithin(repoPaths.integrationsRoot, integrationId);
    await assertPathInsideRoot(repoRoot, integrationRoot);

    if (!(await isDirectory(integrationRoot))) {
      risks.push({ code: "INTEGRATION_NOT_FOUND", message: `未找到对接：${integrationId}` });
      continue;
    }

    const perHealthy = [];
    const perMissing = [];
    const perRisks = [];
    let meta = null;

    for (const fileName of DEFAULT_INTEGRATION_FILES) {
      const targetPath = resolvePathWithin(integrationRoot, fileName);
      const relative = toRelative(repoRoot, targetPath);
      if (await pathExists(targetPath)) {
        healthy.push(relative);
        perHealthy.push(relative);

        const content = await readText(targetPath);
        if (fileName === "meta.json") {
          try {
            meta = JSON.parse(content);
            if (meta.id && meta.id !== integrationId) {
              perRisks.push({ code: "INVALID_INTEGRATION_META", message: `对接元信息 ID 与目录不一致：${relative}` });
            }
            if (!INTEGRATION_STATES.includes(meta.status)) {
              perRisks.push({ code: "INVALID_INTEGRATION_STATUS", message: `对接状态不合法：${relative}` });
            }
          } catch {
            perRisks.push({ code: "INVALID_INTEGRATION_META", message: `对接元信息无法解析：${relative}` });
          }
        }

        if (fileName === "contract.md" && isPlaceholderContract(content)) {
          perRisks.push({ code: "PLACEHOLDER_INTEGRATION_CONTRACT", message: `contract.md 仍是占位内容：${relative}` });
        }

        if (fileName === "decisions.md" && isPlaceholderDecisions(content)) {
          perRisks.push({ code: "PLACEHOLDER_INTEGRATION_DECISIONS", message: `decisions.md 仍是占位内容：${relative}` });
        }

        if (fileName === "status.md" && isPlaceholderStatus(content)) {
          perRisks.push({ code: "PLACEHOLDER_INTEGRATION_STATUS", message: `status.md 仍是占位内容：${relative}` });
        }
      } else {
        missing.push(relative);
        perMissing.push(relative);
      }
    }

    if (!meta) {
      perRisks.push({ code: "MISSING_INTEGRATION_META", message: `对接缺少可读取的元信息：${toRelative(repoRoot, integrationRoot)}` });
    }

    risks.push(...perRisks);
    const writeback = filterWritebackQueue(writebackQueue, {
      scope: "integration",
      targetId: meta?.id || integrationId
    });
    const governance = await inspectGovernanceTarget({
      repoRoot,
      scope: "integration",
      targetId: meta?.id || integrationId
    });
    const governanceIssue = buildInvalidGovernanceIssue({
      governance,
      scope: "integration",
      targetId: meta?.id || integrationId
    });
    integrations.push({
      id: meta?.id || integrationId,
      provider: meta?.provider || "未知",
      consumers: meta?.consumers || [],
      changes: meta?.changes || [],
      status: meta?.status || "unknown",
      canonicalStage: meta?.canonicalStage || mapIntegrationStateToCanonical(meta?.status || "draft"),
      legacyStage: meta?.legacyStage || meta?.status || "unknown",
      summary: summarizeIntegration({ meta, risks: perRisks, missing: perMissing }),
      action: buildIntegrationAction({ meta, risks: perRisks, missing: perMissing }),
      governance,
      writeback,
      healthy: perHealthy,
      missing: perMissing,
      risks: perRisks
    });
    if (governanceIssue) {
      risks.push(governanceIssue);
    }
  }

  const gate = buildScopedRuleGate({
    scope: "integration",
    runtimeRules,
    items: integrations
  });

  return {
    requestedId,
    integrations,
    summary: summarizeIntegrationDecisionView(integrations),
    healthy,
    missing,
    risks,
    runtimeRules: summarizeRuntimeRules(runtimeRules),
    blocking: gate.blocking,
    advisory: gate.advisory,
    governanceMode,
    nextStep: buildIntegrationNextStepContract({ requestedId, integrations, missing, risks, blocking: gate.blocking, governanceMode })
  };
}

export async function updateIntegrationStage({ repoRoot, rawIntegrationId, toState }) {
  const integration = await loadIntegration(repoRoot, rawIntegrationId);
  if (["aligned", "implementing", "integrating", "done"].includes(toState)) {
    const report = await inspectIntegrations({
      repoRoot,
      rawIntegrationId: integration.integrationId
    });

    if (report.blocking?.length) {
      throw new IntegrationWorkflowError("PRECONDITION_FAILED", formatRuleBlockingMessage(report.blocking));
    }
  }

  if (toState === "implementing") {
    await assertIntegrationGovernanceGate({
      repoRoot,
      integrationId: integration.integrationId,
      toState
    });
  }

  if (toState === "done") {
    await assertIntegrationGovernanceGate({
      repoRoot,
      integrationId: integration.integrationId,
      toState
    });
  }

  if (!isAllowedIntegrationTransition(integration.meta.status, toState)) {
    throw new IntegrationWorkflowError("INVALID_STAGE_TRANSITION", `不允许从 ${integration.meta.status} 进入 ${toState}`);
  }

  const statusContent = await readText(integration.statusPath);
  if (toState === "blocked" && statusContent.includes("无 / 阻塞项描述")) {
    throw new IntegrationWorkflowError("PRECONDITION_FAILED", "进入 blocked 前必须在 status.md 写明阻塞原因");
  }
  if (toState === "done" && !statusContent.includes("验证结论") ) {
    throw new IntegrationWorkflowError("PRECONDITION_FAILED", "进入 done 前必须在 status.md 写明验证结论");
  }

  const nextMeta = {
    ...integration.meta,
    status: toState,
    legacyStage: toState,
    canonicalStage: mapIntegrationStateToCanonical(toState),
    updatedAt: new Date().toISOString()
  };
  await writeText(integration.metaPath, `${JSON.stringify(nextMeta, null, 2)}\n`);

  let nextStatus = statusContent.replace(/- 状态：`[^`]*`/, `- 状态：\`${toState}\``);
  nextStatus = nextStatus.replace(/- 更新时间：`[^`]*`/, `- 更新时间：\`${nextMeta.updatedAt}\``);
  await writeText(integration.statusPath, nextStatus);
  await updateExecutionPointers({
    repoRoot,
    integrationRef: {
      integrationId: nextMeta.id,
      path: toRelative(repoRoot, integration.integrationRoot)
    },
    currentPhase: nextMeta.canonicalStage
  });
  await syncRuntimeLinksForRepo({ repoRoot });
  await updateRepositoryIndexes({ repoRoot });

  return {
    id: nextMeta.id,
    provider: nextMeta.provider,
    consumers: nextMeta.consumers,
    changes: nextMeta.changes,
    status: nextMeta.status,
    canonicalStage: nextMeta.canonicalStage,
    legacyStage: nextMeta.legacyStage || nextMeta.status,
    updatedAt: nextMeta.updatedAt
  };
}

export function normalizeIntegrationStageInput(rawState) {
  const value = String(rawState || "").trim();
  if (INTEGRATION_STATES.includes(value)) {
    return value;
  }
  switch (value) {
    case "clarify":
      return "draft";
    case "plan":
      return "aligned";
    case "execute":
      return "implementing";
    case "verify":
      return "integrating";
    case "accept":
      return "done";
    default:
      return value;
  }
}

export function getSupportedIntegrationStageInputs() {
  return [...INTEGRATION_STATES, ...INTEGRATION_CANONICAL_PHASES];
}

export async function getIntegrationIndex({ repoRoot }) {
  const report = await inspectIntegrations({ repoRoot });
  return new Map(report.integrations.map((item) => [item.id, item]));
}

async function loadIntegration(repoRoot, rawIntegrationId) {
  const repoPaths = getRepoPaths(repoRoot);
  const integrationId = normalizeIntegrationId(rawIntegrationId);
  const integrationRoot = resolvePathWithin(repoPaths.integrationsRoot, integrationId);
  await assertPathInsideRoot(repoRoot, integrationRoot);

  if (!(await isDirectory(integrationRoot))) {
    throw new IntegrationWorkflowError("INTEGRATION_NOT_FOUND", `未找到对接：${integrationId}`);
  }

  const metaPath = resolvePathWithin(integrationRoot, "meta.json");
  const statusPath = resolvePathWithin(integrationRoot, "status.md");
  if (!(await pathExists(metaPath))) {
    throw new IntegrationWorkflowError("WRITE_DENIED", `对接缺少元信息文件：${toRelative(repoRoot, metaPath)}`);
  }

  let meta;
  try {
    meta = await readJson(metaPath);
  } catch {
    throw new IntegrationWorkflowError("WRITE_DENIED", `对接元信息无法解析：${toRelative(repoRoot, metaPath)}`);
  }

  if (meta.id && meta.id !== integrationId) {
    throw new IntegrationWorkflowError("WRITE_DENIED", "对接元信息 ID 与目录不一致，拒绝继续处理");
  }

  return { integrationId, integrationRoot, metaPath, statusPath, meta };
}

async function getExistingIntegrationIds(integrationsRoot) {
  if (!(await pathExists(integrationsRoot))) {
    return [];
  }
  const entries = await listDir(integrationsRoot);
  const ids = [];
  for (const entry of entries) {
    const targetPath = path.join(integrationsRoot, entry);
    if (await isDirectory(targetPath)) {
      ids.push(entry);
    }
  }
  return ids.sort();
}

function isAllowedIntegrationTransition(currentState, toState) {
  if (currentState === toState) {
    return true;
  }
  const transitions = {
    draft: ["aligned", "blocked"],
    aligned: ["implementing", "blocked"],
    implementing: ["integrating", "blocked"],
    integrating: ["done", "blocked"],
    blocked: ["aligned", "implementing", "integrating"],
    done: []
  };
  return Boolean(transitions[currentState]?.includes(toState));
}

async function assertIntegrationGovernanceGate({ repoRoot, integrationId, toState }) {
  const governance = await inspectGovernanceTarget({
    repoRoot,
    scope: "integration",
    targetId: integrationId
  });

  if ((governance.invalidCount || 0) > 0 && ["implementing", "done"].includes(toState)) {
    throw new IntegrationWorkflowError("PRECONDITION_FAILED", "进入治理门禁阶段前必须先修复无效 governance record");
  }

  if (toState === "implementing") {
    if (!governance.gateSummary.hasReview) {
      throw new IntegrationWorkflowError("PRECONDITION_FAILED", "进入 implementing 前至少需要 1 条 review-record");
    }

    if (governance.gateSummary.hasRejectedReview) {
      throw new IntegrationWorkflowError("PRECONDITION_FAILED", "进入 implementing 前存在 verdict=rejected 的 review-record");
    }
  }

  if (toState === "done") {
    if (!governance.gateSummary.hasPassedVerification) {
      throw new IntegrationWorkflowError("PRECONDITION_FAILED", "进入 done 前至少需要 1 条 verification-record，且 result=passed");
    }

    if (!governance.gateSummary.hasApprovedApproval) {
      throw new IntegrationWorkflowError("PRECONDITION_FAILED", "进入 done 前至少需要 1 条 approval-record，且 decision=approved");
    }
  }
}

function isPlaceholderContract(content) {
  return (
    /^\s*-\s*接口 \/ service 名称：\s*$/m.test(content) ||
    /^\s*-\s*提供方负责：\s*$/m.test(content) ||
    content.includes("- [ ] 条件 1")
  );
}

function isPlaceholderDecisions(content) {
  return /^\s*-\s*决策 1：\s*$/m.test(content) || /^\s*-\s*待定项 1：\s*$/m.test(content);
}

function isPlaceholderStatus(content) {
  return (
    content.includes("- 无 / 阻塞项描述") ||
    content.includes("- 已完成项 1") ||
    /^\s*-\s*下一动作：\s*$/m.test(content)
  );
}

function summarizeIntegration({ meta, risks, missing }) {
  if (!meta) return "元信息异常";
  if (missing.length || risks.length) return "存在阻塞";
  switch (meta.status) {
    case "draft": return "待对齐";
    case "aligned": return "已对齐";
    case "implementing": return "实现中";
    case "integrating": return "联调中";
    case "blocked": return "已阻塞";
    case "done": return "已完成";
    default: return "未知";
  }
}

function buildIntegrationAction({ meta, risks, missing }) {
  if (!meta) return "先修复对接元信息";
  if (missing.length) return "先补齐对接文件";
  if (risks.some((item) => item.code === "PLACEHOLDER_INTEGRATION_CONTRACT")) return "先补 contract.md";
  if (risks.some((item) => item.code === "PLACEHOLDER_INTEGRATION_STATUS")) return "先补 status.md";
  switch (meta.status) {
    case "draft": return "先补契约并推进 aligned";
    case "aligned": return "可开始实现";
    case "implementing": return "继续实现";
    case "integrating": return "继续联调";
    case "blocked": return "先解除阻塞";
    default: return "当前无";
  }
}

function toRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}

function summarizeRuntimeRules(runtimeRules) {
  if (!runtimeRules) {
    return null;
  }

  return {
    path: runtimeRules.path,
    enabledModules: runtimeRules.enabledModules,
    blockingScopes: runtimeRules.blockingScopes,
    advisoryScopes: runtimeRules.advisoryScopes
  };
}

function getGovernanceEvidenceRelativeDirs() {
  return ["evidence/reviews", "evidence/approvals", "evidence/verifications"];
}

async function ensureGovernanceEvidenceDirs(integrationRoot) {
  for (const relativeDir of getGovernanceEvidenceRelativeDirs()) {
    await ensureDir(path.join(integrationRoot, relativeDir));
  }
}

function summarizeIntegrationDecisionView(integrations) {
  const blockedIds = [];
  const readyIds = [];
  const affectedChanges = new Set();

  for (const item of integrations ?? []) {
    if (["aligned", "implementing", "integrating", "done"].includes(item.status)) {
      readyIds.push(item.id);
    }

    if (item.status === "blocked" || item.missing?.length || item.risks?.length) {
      blockedIds.push(item.id);
      for (const changeId of item.changes || []) {
        affectedChanges.add(changeId);
      }
    }
  }

  return {
    total: integrations?.length ?? 0,
    readyCount: readyIds.length,
    readyIds,
    blockedCount: blockedIds.length,
    blockedIds,
    affectedChanges: Array.from(affectedChanges).sort()
  };
}

function mapIntegrationStateToCanonical(state) {
  switch (state) {
    case "draft":
      return "clarify";
    case "aligned":
      return "plan";
    case "implementing":
      return "execute";
    case "integrating":
      return "verify";
    case "done":
      return "accept";
    case "blocked":
      return "plan";
    default:
      return "clarify";
  }
}

function buildIntegrationNextStepContract({ requestedId, integrations, missing, risks, blocking, governanceMode }) {
  const target = requestedId ? integrations[0] : integrations[0] || null;
  const runtimeMissing = target?.writeback?.targetDocs?.map((item) => `待回写：${item}`) || [];
  const governanceBlocking = target ? buildGovernanceBlockingTexts({ governance: target.governance }) : [];
  return {
    currentPhase: target ? target.canonicalStage : "clarify",
    governanceMode,
    completed: target ? [`${target.id} 当前处于 ${target.canonicalStage}`] : [],
    missing: [...missing.map((item) => item), ...runtimeMissing],
    blocking: Array.from(
      new Set([...governanceBlocking, ...(blocking || []).map((item) => `${item.code}：${item.message}`)])
    ),
    recommendedNext: buildIntegrationRecommendedNext({ target, risks, missing, blocking }),
    writebackRequired: Boolean(target?.writeback?.count),
    projectionDrift: false,
    skillPackDrift: false,
    updatedAt: new Date().toISOString()
  };
}

function buildIntegrationRecommendedNext({ target, risks, missing, blocking }) {
  if (!target) {
    return [{ type: "cli", value: "specnfc integration create <integration-id>" }];
  }
  if ((target.governance?.invalidCount || 0) > 0) {
    const invalidFiles = (target.governance?.invalidSummary?.samples || [])
      .map((item) => item.file)
      .filter(Boolean)
      .slice(0, 3)
      .map((item) => ({ type: "doc", value: item }));
    return [
      ...invalidFiles,
      { type: "cli", value: "specnfc doctor --json" },
      { type: "cli", value: `specnfc integration check ${target.id}` }
    ];
  }
  if (target.writeback?.count) {
    return target.writeback.targetDocs.map((item) => ({ type: "doc", value: item }));
  }
  if (missing.length || risks.length || (blocking || []).length) {
    return [
      { type: "cli", value: `specnfc integration check ${target.id}` },
      { type: "skill", value: "集成对齐" }
    ];
  }
  return [{ type: "cli", value: `specnfc integration stage ${target.id} --to ${getNextIntegrationState(target.status)}` }];
}

function getNextIntegrationState(state) {
  switch (state) {
    case "draft":
      return "aligned";
    case "aligned":
      return "implementing";
    case "implementing":
      return "integrating";
    case "integrating":
      return "done";
    default:
      return "aligned";
  }
}

function buildInvalidGovernanceIssue({ governance, scope, targetId }) {
  const invalidCount = governance?.invalidCount || 0;
  if (!invalidCount) {
    return null;
  }

  const reasonSummary = Object.entries(governance.invalidSummary?.byReason || {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => `${reason}×${count}`)
    .join("、");
  const sampleFiles = (governance.invalidSummary?.samples || []).map((item) => item.file).filter(Boolean);

  return {
    code: "INVALID_GOVERNANCE_RECORDS",
    message: `存在 ${invalidCount} 条无效 governance record${reasonSummary ? `：${reasonSummary}` : ""}`,
    file: sampleFiles[0] ?? null,
    action: `先修复 ${scope} ${targetId} 的无效 governance record（JSON / scope / target / 引用）后重新运行 \`specnfc ${scope} check ${targetId}\``
  };
}

function buildGovernanceBlockingTexts({ governance }) {
  const invalidCount = governance?.invalidCount || 0;
  if (!invalidCount) {
    return [];
  }

  const reasonSummary = Object.entries(governance.invalidSummary?.byReason || {})
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([reason, count]) => `${reason}×${count}`)
    .join("、");

  return [`INVALID_GOVERNANCE_RECORDS：存在 ${invalidCount} 条无效 governance record${reasonSummary ? `：${reasonSummary}` : ""}`];
}

function buildScopedRuleGate({ scope, runtimeRules, items = [] }) {
  const blocking = [];
  const advisory = [];
  const blockingEnabled = runtimeRules?.blockingScopes?.includes(scope);
  const advisoryEnabled = runtimeRules?.advisoryScopes?.includes(scope);

  for (const item of items) {
    for (const missingFile of item.missing ?? []) {
      const normalized = {
        scope,
        itemType: "integration",
        id: item.id,
        stage: item.status ?? "unknown",
        code: "MISSING_REQUIRED_FILE",
        message: `缺少必需文件：${missingFile}`,
        file: missingFile,
        action: "先补齐缺失文件"
      };
      if (blockingEnabled) {
        blocking.push(normalized);
      } else if (advisoryEnabled) {
        advisory.push(normalized);
      }
    }

    for (const issue of item.risks ?? []) {
      const normalized = {
        scope,
        itemType: "integration",
        id: item.id,
        stage: item.status ?? "unknown",
        code: issue.code,
        message: issue.message,
        file: issue.file ?? null,
        action: item.action ?? "先修复当前规则问题"
      };
      if (blockingEnabled) {
        blocking.push(normalized);
      } else if (advisoryEnabled) {
        advisory.push(normalized);
      }
    }
  }

  return {
    blocking,
    advisory
  };
}

function formatRuleBlockingMessage(items = []) {
  const top = items.slice(0, 3).map((item) => item.file || item.code).filter(Boolean);
  const detail = top.length ? `：${top.join("、")}` : "";
  return `INTEGRATION_RULES_BLOCKING：当前 integration 存在规则阻断，需先修复后再推进${detail}`;
}
