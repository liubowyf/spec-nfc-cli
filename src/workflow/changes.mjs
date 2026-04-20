import path from "node:path";
import { loadConfig } from "../kernel/config.mjs";
import { inspectGovernanceTarget } from "../kernel/governance-records.mjs";
import { readRepositoryGovernanceMode } from "../kernel/governance.mjs";
import { PROJECT_ROOT, getRepoPaths, resolvePathWithin } from "../kernel/paths.mjs";
import { buildActiveRules } from "../kernel/rules.mjs";
import { updateExecutionPointers } from "../kernel/execution-pointers.mjs";
import { updateRepositoryIndexes } from "../kernel/indexes.mjs";
import { filterWritebackQueue, inspectWritebackQueue, syncRuntimeLinksForRepo } from "../kernel/writeback.mjs";
import { assertPathInsideRoot, ensureDir, isDirectory, listDir, movePath, pathExists, readJson, readText, writeJson, writeText } from "../utils/fs.mjs";
import { renderTemplate, toSlug } from "../utils/text.mjs";
import { getIntegrationIndex } from "./integrations.mjs";

export const CHANGE_DOC_ROLE_FILES = {
  requirementsAndSolution: "01-需求与方案.md",
  technicalDesign: "02-技术设计与选型.md",
  planAndExecution: "03-任务计划与执行.md",
  acceptanceAndHandoff: "04-验收与交接.md"
};
export const DEFAULT_CHANGE_FILES = Object.values(CHANGE_DOC_ROLE_FILES);
export const CHANGE_STAGES = ["draft", "design", "ready", "in-progress", "verifying", "handoff", "archived"];
const CHANGE_CANONICAL_PHASES = ["clarify", "design", "plan", "execute", "verify", "accept", "archive"];
const REQUIRED_CHANGE_FILES = [...DEFAULT_CHANGE_FILES, "runtime-links.json"];
const DELIVERY_CHANGE_FILES = ["commit-message.md", "delivery-checklist.md"];
const LEGACY_CHANGE_FILES = ["proposal.md", "design.md", "spec.md", "capabilities.md", "spec-deltas.md", "plan.md", "tasks.md", "decisions.md", "status.md", "acceptance.md"];
const V31_CHANGE_FILE_SET = new Set(DEFAULT_CHANGE_FILES);

const CHANGE_TEMPLATE_ROOT = path.join(PROJECT_ROOT, "src/workflow/templates/change");

class ChangeWorkflowError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ChangeWorkflowError";
    this.code = code;
  }
}

export function normalizeChangeId(rawChangeId) {
  return toSlug(String(rawChangeId ?? ""));
}

export function buildCanonicalChangeDocRoles() {
  return { ...CHANGE_DOC_ROLE_FILES };
}

function usesMergedChangeDocs(config) {
  const structure = getChangeStructure(config);
  return structure.length === DEFAULT_CHANGE_FILES.length && structure.every((fileName) => V31_CHANGE_FILE_SET.has(fileName));
}

function getChangeDocRoles(meta = {}) {
  return {
    ...buildCanonicalChangeDocRoles(),
    ...(meta.docRoles || {})
  };
}

function getChangeDocPath(changeRoot, meta, role) {
  const docRoles = getChangeDocRoles(meta);
  const relativePath = docRoles[role];
  if (!relativePath) {
    throw new ChangeWorkflowError("INVALID_DOC_ROLE", `未找到 change 文档角色：${role}`);
  }
  return resolvePathWithin(changeRoot, relativePath);
}

async function pathExistsForDocRole(changeRoot, meta, role) {
  const targetPath = getChangeDocPath(changeRoot, meta, role);
  return pathExists(targetPath);
}

function buildChangeCreateContext({ changeId, title, type, config, repoRoot, createdAt }) {
  const docRoles = buildCanonicalChangeDocRoles();
  return {
    changeId,
    changeTitle: title || changeId,
    changeType: type,
    changeStage: "draft",
    changeCanonicalStage: mapLegacyChangeStageToCanonical("draft"),
    createdAt,
    updatedAt: createdAt,
    templateVersion: config.specnfc?.templateVersion ?? config.specnfc?.version ?? "0.0.0",
    repositoryName: config.repository?.name ?? path.basename(repoRoot),
    requirementsAndSolutionPath: docRoles.requirementsAndSolution,
    technicalDesignPath: docRoles.technicalDesign,
    planAndExecutionPath: docRoles.planAndExecution,
    acceptanceAndHandoffPath: docRoles.acceptanceAndHandoff
  };
}

export async function createChange({
  repoRoot,
  rawChangeId,
  title,
  type = "feature",
  dryRun = false
}) {
  const config = await loadConfig(repoRoot);
  const changeId = normalizeChangeId(rawChangeId);
  const repoPaths = getRepoPaths(repoRoot);
  const changeRoot = resolvePathWithin(repoPaths.changesRoot, changeId);
  await assertPathInsideRoot(repoRoot, changeRoot);
  const createdAt = new Date().toISOString();
  const structure = validateCreateChangeStructure({ config, changeRoot });

  const context = buildChangeCreateContext({
    changeId,
    title,
    type,
    config,
    repoRoot,
    createdAt
  });

  const created = [];

  if (!dryRun) {
    await ensureDir(changeRoot);
    await ensureGovernanceEvidenceDirs(changeRoot);
  }

  for (const relativeDir of getGovernanceEvidenceRelativeDirs()) {
    created.push(toRelative(repoRoot, path.join(changeRoot, relativeDir)));
  }

  const requiredFiles = Array.from(new Set([...REQUIRED_CHANGE_FILES, ...structure]));
  for (const fileName of ["meta.json", ...requiredFiles, ...getDeliveryChangeFiles(config)]) {
    const targetPath = resolvePathWithin(changeRoot, fileName);
    const sourcePath = resolvePathWithin(CHANGE_TEMPLATE_ROOT, fileName);
    await assertPathInsideRoot(repoRoot, targetPath);
    await assertPathInsideRoot(CHANGE_TEMPLATE_ROOT, sourcePath);
    const rendered = renderTemplate(await readText(sourcePath), context);

    if (!dryRun) {
      await writeText(targetPath, rendered);
    }

    created.push(toRelative(repoRoot, targetPath));
  }

  if (!dryRun) {
    await updateExecutionPointers({
      repoRoot,
      changeRef: {
        changeId,
        path: toRelative(repoRoot, changeRoot)
      },
      currentPhase: context.changeCanonicalStage
    });
    await syncRuntimeLinksForRepo({ repoRoot });
    await updateRepositoryIndexes({ repoRoot });
  }

  return {
    changeId,
    title: context.changeTitle,
    type: context.changeType,
    stage: context.changeStage,
    canonicalStage: context.changeCanonicalStage,
    changeRoot: toRelative(repoRoot, changeRoot),
    created
  };
}

function validateCreateChangeStructure({ config, changeRoot }) {
  const configured = config.defaults?.changeStructure;
  if (!Array.isArray(configured) || !configured.length) {
    return DEFAULT_CHANGE_FILES;
  }

  for (const fileName of configured) {
    try {
      resolvePathWithin(changeRoot, fileName);
    } catch (error) {
      throw new ChangeWorkflowError(
        "WRITE_DENIED",
        error instanceof Error ? error.message : "changeStructure 路径非法"
      );
    }
  }

  if (!usesMergedChangeDocs(config)) {
    throw new ChangeWorkflowError(
      "INVALID_CONFIG",
      "当前仓的 `defaults.changeStructure` 仍不是四主文档结构；请先运行 `specnfc upgrade` 或修正 `.specnfc/config.json` 后再创建 change"
    );
  }

  return DEFAULT_CHANGE_FILES;
}

export async function updateChangeStage({
  repoRoot,
  rawChangeId,
  toStage
}) {
  const change = await loadChange(repoRoot, rawChangeId);
  const config = await loadConfig(repoRoot);

  if (toStage === "in-progress") {
    const report = await inspectChanges({
      repoRoot,
      rawChangeId: change.changeId
    });
    const blocking = report.blocking ?? [];

    if (blocking.length) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", formatRuleBlockingMessage("change", blocking));
    }
  }

  if (toStage === "verifying") {
    await assertChangeGovernanceGate({
      repoRoot,
      changeId: change.changeId,
      toStage
    });
  }

  if (toStage === "handoff") {
    await assertChangeGovernanceGate({
      repoRoot,
      changeId: change.changeId,
      toStage
    });
  }

  const nextMeta = {
    ...change.meta,
    stage: toStage,
    legacyStage: toStage,
    canonicalStage: mapLegacyChangeStageToCanonical(toStage),
    updatedAt: new Date().toISOString()
  };

  await writeJson(change.metaPath, nextMeta);
  await updateExecutionPointers({
    repoRoot,
    changeRef: {
      changeId: nextMeta.id,
      path: toRelative(repoRoot, change.changeRoot)
    },
    currentPhase: nextMeta.canonicalStage
  });
  await syncRuntimeLinksForRepo({ repoRoot });
  await updateRepositoryIndexes({ repoRoot });
  if (config.modules?.delivery?.enabled) {
    await syncDeliveryChecklistForStage(change.changeRoot, nextMeta);
  }

  return {
    changeId: nextMeta.id,
    title: nextMeta.title,
    type: nextMeta.type,
    stage: nextMeta.stage,
    canonicalStage: nextMeta.canonicalStage,
    legacyStage: nextMeta.legacyStage || nextMeta.stage,
    updatedAt: nextMeta.updatedAt
  };
}

export async function generateChangeHandoff({
  repoRoot,
  rawChangeId,
  force = false,
  dryRun = false
}) {
  const change = await loadChange(repoRoot, rawChangeId);
  const config = await loadConfig(repoRoot);
  const mergedDocs = usesMergedChangeDocs(config);
  const targetPath = mergedDocs
    ? getChangeDocPath(change.changeRoot, change.meta, "acceptanceAndHandoff")
    : resolvePathWithin(change.changeRoot, "release-handoff.md");
  const targetExists = await pathExists(targetPath);

  if (!mergedDocs && targetExists && !force) {
    throw new Error("HANDOFF_EXISTS");
  }

  const nextMeta = {
    ...change.meta,
    stage: "handoff",
    legacyStage: "handoff",
    canonicalStage: mapLegacyChangeStageToCanonical("handoff"),
    updatedAt: new Date().toISOString()
  };
  const handoffSummary = await buildChangeHandoffSummary({
    repoRoot,
    changeRoot: change.changeRoot,
    changeId: change.changeId,
    config,
    meta: nextMeta
  });

  let rendered = null;
  if (!mergedDocs) {
    const template = await readText(resolvePathWithin(CHANGE_TEMPLATE_ROOT, "release-handoff.md"));
    rendered = renderTemplate(template, {
      changeId: nextMeta.id,
      changeTitle: nextMeta.title,
      changeType: nextMeta.type,
      changeStage: nextMeta.stage,
      createdAt: nextMeta.createdAt,
      updatedAt: nextMeta.updatedAt,
      summaryBlock: toMarkdownBullets(handoffSummary.summaryLines, "- 当前无"),
      impactBlock: toMarkdownBullets(handoffSummary.impactLines, "- 当前无"),
      riskBlock: toMarkdownBullets(handoffSummary.riskLines, "- 当前无"),
      rollbackBlock: toMarkdownBullets(handoffSummary.rollbackLines, "- 当前无"),
      verificationBlock: toMarkdownBullets(handoffSummary.verificationLines, "- 当前无")
    });
  }

  if (config.modules?.delivery?.enabled && !mergedDocs) {
    const deliveryChecklistPath = resolvePathWithin(change.changeRoot, "delivery-checklist.md");
    if (!(await pathExists(deliveryChecklistPath))) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", "生成交接单前必须先补 delivery-checklist.md");
    }
  }
  await assertAcceptanceReadyForHandoff(change.changeRoot, nextMeta);

  if (!dryRun) {
    await writeJson(change.metaPath, nextMeta);
    if (!mergedDocs && rendered) {
      await writeText(targetPath, rendered);
    }
    await updateExecutionPointers({
      repoRoot,
      changeRef: {
        changeId: nextMeta.id,
        path: toRelative(repoRoot, change.changeRoot)
      },
      currentPhase: nextMeta.canonicalStage
    });
    await syncRuntimeLinksForRepo({ repoRoot });
    await syncDeliveryChecklistForStage(change.changeRoot, nextMeta, { markHandoff: true });
    await updateRepositoryIndexes({ repoRoot });
  }

  return {
    changeId: nextMeta.id,
    title: nextMeta.title,
    type: nextMeta.type,
    stage: nextMeta.stage,
    canonicalStage: nextMeta.canonicalStage,
    legacyStage: nextMeta.legacyStage || nextMeta.stage,
    handoffPath: toRelative(repoRoot, targetPath),
    handoffSummary
  };
}

export async function archiveChange({
  repoRoot,
  rawChangeId,
  force = false,
  dryRun = false
}) {
  const change = await loadChange(repoRoot, rawChangeId);
  const config = await loadConfig(repoRoot);
  const repoPaths = getRepoPaths(repoRoot);
  const targetRoot = resolvePathWithin(repoPaths.archiveRoot, change.changeId);
  await assertPathInsideRoot(repoRoot, targetRoot);

  if ((await pathExists(targetRoot)) && !force) {
    throw new Error("ARCHIVE_EXISTS");
  }

  const mergedDocs = usesMergedChangeDocs(config);
  const handoffPath = mergedDocs
    ? getChangeDocPath(change.changeRoot, change.meta, "acceptanceAndHandoff")
    : resolvePathWithin(change.changeRoot, "release-handoff.md");
  if (!mergedDocs && !(await pathExists(handoffPath)) && !force) {
    throw new ChangeWorkflowError("PRECONDITION_FAILED", "归档前必须先生成 release-handoff.md");
  }
  await assertAcceptanceReadyForHandoff(change.changeRoot, change.meta);
  if (!mergedDocs && (await pathExists(handoffPath))) {
    await assertReleaseHandoffSections(handoffPath);
  }

  if (config.modules?.delivery?.enabled && !mergedDocs) {
    const deliveryChecklistPath = resolvePathWithin(change.changeRoot, "delivery-checklist.md");
    if (!(await pathExists(deliveryChecklistPath))) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", "归档前必须先补 delivery-checklist.md");
    }

    const deliveryChecklist = await readText(deliveryChecklistPath);
    if (!deliveryChecklist.includes("- [x] 如需发布交接，`release-handoff.md` 已补齐")) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", "归档前必须先确认 delivery-checklist.md 中的交接项");
    }
  }

  const nextMeta = {
    ...change.meta,
    stage: "archived",
    legacyStage: "archived",
    canonicalStage: mapLegacyChangeStageToCanonical("archived"),
    updatedAt: new Date().toISOString()
  };

  if (!dryRun) {
    await syncDeliveryChecklistForStage(change.changeRoot, nextMeta, { markArchived: true });
    await writeJson(change.metaPath, nextMeta);
    await movePath(change.changeRoot, targetRoot);
    await updateExecutionPointers({
      repoRoot,
      changeRef: {
        changeId: nextMeta.id,
        path: toRelative(repoRoot, targetRoot)
      },
      currentPhase: nextMeta.canonicalStage
    });
    await syncRuntimeLinksForRepo({ repoRoot });
    await updateRepositoryIndexes({ repoRoot });
  }

  return {
    changeId: nextMeta.id,
    title: nextMeta.title,
    type: nextMeta.type,
    stage: nextMeta.stage,
    canonicalStage: nextMeta.canonicalStage,
    legacyStage: nextMeta.legacyStage || nextMeta.stage,
    archivePath: toRelative(repoRoot, targetRoot)
  };
}

async function assertAcceptanceReadyForHandoff(changeRoot, meta) {
  if (meta?.docRoles?.acceptanceAndHandoff) {
    const mergedPath = getChangeDocPath(changeRoot, meta, "acceptanceAndHandoff");
    if (!(await pathExists(mergedPath))) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", "进入 handoff / archive 前必须先补 04-验收与交接.md");
    }

    const content = await readText(mergedPath);
    if (isPlaceholderAcceptanceAndHandoff(content)) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", "进入 handoff / archive 前必须先完善 04-验收与交接.md");
    }

    for (const section of ["## 验收范围", "## 验证方式与结果", "## 剩余风险与结论", "## 交付与发布交接", "## 提交说明"]) {
      if (!content.includes(section)) {
        throw new ChangeWorkflowError("PRECONDITION_FAILED", `04-验收与交接.md 缺少关键章节：${section}`);
      }
    }

    if (!content.includes("是否允许进入 handoff / archive")) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", "04-验收与交接.md 必须写明是否允许进入 handoff / archive");
    }

    return;
  }

  const acceptancePath = resolvePathWithin(changeRoot, "acceptance.md");
  if (!(await pathExists(acceptancePath))) {
    throw new ChangeWorkflowError("PRECONDITION_FAILED", "进入 handoff / archive 前必须先补 acceptance.md");
  }

  const acceptance = await readText(acceptancePath);
  if (isPlaceholderAcceptance(acceptance)) {
    throw new ChangeWorkflowError("PRECONDITION_FAILED", "进入 handoff / archive 前必须先完善 acceptance.md");
  }

  if (!acceptance.includes("## 结论")) {
    throw new ChangeWorkflowError("PRECONDITION_FAILED", "进入 handoff / archive 前 acceptance.md 必须包含结论");
  }
}

function isPlaceholderAcceptance(content) {
  const normalized = String(content || "");
  return (
    /^\s*-\s*范围 1：\s*$/m.test(normalized) ||
    /^\s*-\s*单元测试：\s*$/m.test(normalized) ||
    /^\s*-\s*结果 1：\s*$/m.test(normalized) ||
    /^\s*-\s*是否满足当前阶段要求：\s*$/m.test(normalized) ||
    /^\s*-\s*是否允许进入 accept \/ archive：\s*$/m.test(normalized)
  );
}

function isPlaceholderAcceptanceAndHandoff(content) {
  const normalized = String(content || "");
  return (
    /^\s*-\s*范围 1：\s*$/m.test(normalized) ||
    /^\s*-\s*结果 1：\s*$/m.test(normalized) ||
    /^\s*-\s*对外变更摘要：\s*$/m.test(normalized) ||
    /^\s*-\s*变更摘要：\s*$/m.test(normalized)
  );
}

async function assertReleaseHandoffSections(handoffPath) {
  const handoff = await readText(handoffPath);
  for (const section of ["## 变更摘要", "## 发布关注点", "## 风险说明", "## 回退提示", "## 验证与交接状态"]) {
    if (!handoff.includes(section)) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", `release-handoff.md 缺少关键章节：${section}`);
    }
  }
}

export async function listChanges({ repoRoot }) {
  const repoPaths = getRepoPaths(repoRoot);
  if (!(await pathExists(repoPaths.changesRoot))) {
    return {
      changes: [],
      risks: []
    };
  }
  const report = await inspectChanges({ repoRoot });
  return {
    changes: report.changes,
    risks: report.risks
  };
}

export async function inspectChanges({ repoRoot, rawChangeId }) {
  const config = await loadConfig(repoRoot);
  const repoPaths = getRepoPaths(repoRoot);
  const governanceMode = await readRepositoryGovernanceMode(repoRoot, "guided");
  const runtimeRules = await buildActiveRules({ repoRoot });
  const writebackQueue = await inspectWritebackQueue({ repoRoot });
  const structure = ["meta.json", ...getChangeStructure(config), ...getDeliveryChangeFiles(config)];
  const integrationIndex = await getIntegrationIndex({ repoRoot });
  const healthy = [];
  const missing = [];
  const risks = [];
  const changes = [];

  const requestedId = rawChangeId ? normalizeChangeId(rawChangeId) : null;
  const changeIds = requestedId ? [requestedId] : await getExistingChangeIds(repoPaths.changesRoot);

  for (const changeId of changeIds) {
    const changeRoot = path.join(repoPaths.changesRoot, changeId);
    if (!(await isDirectory(changeRoot))) {
      risks.push({
        code: "CHANGE_NOT_FOUND",
        message: `未找到 change：${changeId}`
      });
      continue;
    }

    const perChangeHealthy = [];
    const perChangeMissing = [];
    const perChangeRisks = [];
    const docContents = {
      requirementsAndSolution: null,
      technicalDesign: null,
      planAndExecution: null,
      acceptanceAndHandoff: null
    };
    const metaPath = path.join(changeRoot, "meta.json");
    let meta = null;

    if (await pathExists(metaPath)) {
      try {
        meta = await readJson(metaPath);
      } catch {
        perChangeRisks.push({
          code: "INVALID_META",
          message: `change 元信息无法解析：${toRelative(repoRoot, metaPath)}`
        });
      }
    }

    for (const fileName of structure) {
      let targetPath;
      try {
        targetPath = resolvePathWithin(changeRoot, fileName);
      } catch {
        perChangeRisks.push({
          code: "INVALID_CHANGE_STRUCTURE",
          message: `change 结构路径非法：${String(fileName)}`
        });
        continue;
      }
      const relative = toRelative(repoRoot, targetPath);

      if (await pathExists(targetPath)) {
        healthy.push(relative);
        perChangeHealthy.push(relative);

        if (fileName === "proposal.md") {
          const content = await readText(targetPath);
          if (
            content.includes("说明这次 change 要解决的核心问题") ||
            hasEmptyBulletPlaceholder(content, "当前选择") ||
            hasEmptyBulletPlaceholder(content, "选择理由")
          ) {
            perChangeRisks.push({
              code: "PLACEHOLDER_PROPOSAL",
              message: `proposal.md 仍是占位内容：${relative}`
            });
          }
        }

        if (fileName === CHANGE_DOC_ROLE_FILES.requirementsAndSolution) {
          const content = await readText(targetPath);
          docContents.requirementsAndSolution = content;
          const issue = buildRequirementsAndSolutionPlaceholderIssue({ content, relative });
          if (issue) {
            perChangeRisks.push(issue);
          }
        }

        if (fileName === "design.md") {
          const content = await readText(targetPath);
          const issue = buildDesignPlaceholderIssue({ content, relative });
          if (issue) {
            perChangeRisks.push(issue);
          }
        }

        if (fileName === CHANGE_DOC_ROLE_FILES.technicalDesign) {
          const content = await readText(targetPath);
          docContents.technicalDesign = content;
          const issue = buildTechnicalDesignPlaceholderIssue({ content, relative });
          if (issue) {
            perChangeRisks.push(issue);
          }
        }

        if (fileName === "spec.md") {
          const content = await readText(targetPath);
          const issue = buildSpecPlaceholderIssue({ content, relative });
          if (issue) {
            perChangeRisks.push(issue);
          }
        }

        if (fileName === "plan.md") {
          const content = await readText(targetPath);
          const issue = buildPlanPlaceholderIssue({ content, relative });
          if (issue) {
            perChangeRisks.push(issue);
          }
        }

        if (fileName === CHANGE_DOC_ROLE_FILES.planAndExecution) {
          const content = await readText(targetPath);
          docContents.planAndExecution = content;
          const issue = buildPlanAndExecutionPlaceholderIssue({ content, relative });
          if (issue) {
            perChangeRisks.push(issue);
          }
        }

        if (fileName === "capabilities.md") {
          const content = await readText(targetPath);
          if (
            content.includes("- 能力 1：") ||
            content.includes("- 接口：\n- 数据：\n- 运营：\n- 发布：")
          ) {
            perChangeRisks.push({
              code: "PLACEHOLDER_CAPABILITIES",
              message: `capabilities.md 仍是占位内容：${relative}`
            });
          }
        }

        if (fileName === "spec-deltas.md") {
          const content = await readText(targetPath);
          if (
            content.includes("- 新增规格点 1：") ||
            content.includes("- 修改规格点 1：") ||
            content.includes("- 删除规格点 1：")
          ) {
            perChangeRisks.push({
              code: "PLACEHOLDER_SPEC_DELTAS",
              message: `spec-deltas.md 仍是占位内容：${relative}`
            });
          }
        }

        if (fileName === "decisions.md") {
          const content = await readText(targetPath);
          if (
            content.includes("### 决策 1") ||
            content.includes("- 背景：\n- 结论：\n- 影响：")
          ) {
            perChangeRisks.push({
              code: "PLACEHOLDER_DECISIONS",
              message: `decisions.md 仍是占位内容：${relative}`
            });
          }
        }

        if (fileName === "status.md") {
          const content = await readText(targetPath);
          if (
            content.includes("只保留当前已确认的结果状态") ||
            content.includes("- 完成 `spec.md`") ||
            content.includes("- 当前无")
          ) {
            perChangeRisks.push({
              code: "PLACEHOLDER_STATUS",
              message: `status.md 仍是占位内容：${relative}`
            });
          }
        }

        if (fileName === CHANGE_DOC_ROLE_FILES.acceptanceAndHandoff) {
          const content = await readText(targetPath);
          docContents.acceptanceAndHandoff = content;
          if (isPlaceholderAcceptanceAndHandoff(content)) {
            perChangeRisks.push({
              code: "PLACEHOLDER_ACCEPTANCE_AND_HANDOFF",
              message: `04-验收与交接.md 仍是占位内容：${relative}`
            });
          }
        }

        if (fileName === "acceptance.md") {
          const content = await readText(targetPath);
          if (isPlaceholderAcceptance(content)) {
            perChangeRisks.push({
              code: "PLACEHOLDER_ACCEPTANCE",
              message: `acceptance.md 仍是占位内容：${relative}`
            });
          }
        }
      } else {
        missing.push(relative);
        perChangeMissing.push(relative);
      }
    }

    const linkedIntegrations = await inspectChangeIntegrationDependencies({
      repoRoot,
      changeRoot,
      structure: getChangeStructure(config),
      integrationIndex
    });
    perChangeRisks.push(...linkedIntegrations.issues);

    if (!meta) {
      perChangeRisks.push({
        code: "MISSING_META",
        message: `change 缺少可读取的元信息：${toRelative(repoRoot, changeRoot)}`
      });
    } else if (["handoff", "archived"].includes(meta.stage)) {
      if (meta.docRoles?.acceptanceAndHandoff) {
        const handoffPath = getChangeDocPath(changeRoot, meta, "acceptanceAndHandoff");
        if (!(await pathExists(handoffPath))) {
          perChangeRisks.push({
            code: "MISSING_ACCEPTANCE_AND_HANDOFF",
            message: `change 已进入 ${meta.stage} 阶段，但缺少 04-验收与交接.md：${toRelative(repoRoot, handoffPath)}`
          });
        }
      } else {
        const handoffPath = resolvePathWithin(changeRoot, "release-handoff.md");
        if (!(await pathExists(handoffPath))) {
          perChangeRisks.push({
            code: "MISSING_HANDOFF",
            message: `change 已进入 ${meta.stage} 阶段，但缺少 release-handoff.md：${toRelative(repoRoot, changeRoot)}`
          });
        }
      }
    }

    const technicalDesignDecision = analyzeTechnicalDesignDecision({
      technicalDesignContent: docContents.technicalDesign
    });
    pruneOptionalTechnicalDesignArtifacts({
      repoRoot,
      changeRoot,
      meta,
      missing,
      perChangeMissing,
      risks: perChangeRisks,
      technicalDesignDecision
    });

    const delivery = meta
      ? await evaluateDeliveryState({
          changeRoot,
          meta,
          config,
          repoRoot
        })
      : { enabled: false, status: "disabled", summary: "未启用", action: "当前无", issues: [] };

    perChangeRisks.push(...delivery.issues);
    const maturity = evaluateMaturityState({
      meta,
      delivery,
      issues: perChangeRisks
    });
    const governance = await inspectGovernanceTarget({
      repoRoot,
      scope: "change",
      targetId: meta?.id || changeId
    });
    const governanceIssue = buildInvalidGovernanceIssue({
      governance,
      scope: "change",
      targetId: meta?.id || changeId
    });
    const writeback = filterWritebackQueue(writebackQueue, {
      scope: "change",
      targetId: meta?.id || changeId
    });

    risks.push(...perChangeRisks);
    if (governanceIssue) {
      risks.push(governanceIssue);
    }
    changes.push({
      id: meta?.id || changeId,
      title: meta?.title || changeId,
      type: meta?.type || "unknown",
      docRoles: getChangeDocRoles(meta || {}),
      stage: meta?.stage || "unknown",
      canonicalStage: meta?.canonicalStage || mapLegacyChangeStageToCanonical(meta?.stage || "draft"),
      legacyStage: meta?.legacyStage || meta?.stage || "unknown",
      delivery,
      maturity,
      integrations: {
        refs: linkedIntegrations.refs,
        blocked: linkedIntegrations.blocked
      },
      governance,
      writeback,
      technicalDesignDecision,
      healthy: perChangeHealthy,
      missing: perChangeMissing,
      risks: perChangeRisks
    });
  }

  const gate = buildScopedRuleGate({
    scope: "change",
    runtimeRules,
    items: changes,
    itemType: "change"
  });
  const projectProtocolIssues = await inspectProjectProtocolGate({ repoRoot, repoPaths });
  const projectProtocolGate = buildProjectProtocolGate({
    governanceMode,
    issues: projectProtocolIssues
  });
  const blocking = [...gate.blocking, ...projectProtocolGate.blocking];
  const advisory = [...gate.advisory, ...projectProtocolGate.advisory];

  return {
    requestedId,
    changes,
    healthy,
    missing,
    risks,
    runtimeRules: summarizeRuntimeRules(runtimeRules),
    governanceMode,
    projectProtocolGate,
    blocking,
    advisory,
    nextStep: buildChangeNextStepContract({
      requestedId,
      changes,
      missing,
      risks,
      governanceMode,
      blocking,
      projectProtocolIssues
    })
  };
}

export function normalizeChangeStageInput(rawStage) {
  const value = String(rawStage || "").trim();
  if (CHANGE_STAGES.includes(value)) {
    return value;
  }
  switch (value) {
    case "clarify":
      return "draft";
    case "design":
      return "design";
    case "plan":
      return "ready";
    case "execute":
      return "in-progress";
    case "verify":
      return "verifying";
    case "accept":
      return "handoff";
    case "archive":
      return "archived";
    default:
      return value;
  }
}

export function getSupportedChangeStageInputs() {
  return [...CHANGE_STAGES, ...CHANGE_CANONICAL_PHASES.filter((item) => item !== "design")];
}

function mapLegacyChangeStageToCanonical(stage) {
  switch (stage) {
    case "draft":
      return "clarify";
    case "design":
      return "design";
    case "ready":
      return "plan";
    case "in-progress":
      return "execute";
    case "verifying":
      return "verify";
    case "handoff":
      return "accept";
    case "archived":
      return "archive";
    default:
      return "clarify";
  }
}

function buildChangeNextStepContract({ requestedId, changes, missing, risks, blocking, governanceMode, projectProtocolIssues = [] }) {
  const target = requestedId ? changes[0] : changes[0] || null;
  const stepGuide = buildChangeStepGuide({
    target,
    missing,
    risks,
    blocking,
    projectProtocolIssues
  });
  const currentPhase = stepGuide.currentPhase ?? (target ? target.canonicalStage : "clarify");
  const runtimeMissing = target?.writeback?.targetDocs?.map((item) => `待回写：${item}`) || [];
  const missingItems = [...missing.map((item) => item), ...projectProtocolIssues.map((item) => item.file), ...runtimeMissing];
  const governanceBlocking = target ? buildGovernanceBlockingTexts({ governance: target.governance }) : [];
  const completed = [];
  if (target) {
    completed.push(`${target.id} 已绑定到阶段 ${target.canonicalStage}`);
  }
  if (!missing.length) {
    completed.push("必需文件已存在");
  }
  return {
    currentPhase,
    governanceMode,
    step: stepGuide.step,
    stepLabel: stepGuide.stepLabel,
    primaryAction: stepGuide.primaryAction,
    primaryDoc: stepGuide.primaryDoc,
    primaryGoal: stepGuide.primaryGoal,
    requiredSections: stepGuide.requiredSections,
    doNotDoYet: stepGuide.doNotDoYet,
    exitCriteria: stepGuide.exitCriteria,
    afterPrimaryAction: stepGuide.afterPrimaryAction,
    completed,
    missing: missingItems,
    blocking: Array.from(
      new Set([...governanceBlocking, ...(blocking || []).map((item) => `${item.code}：${item.message}`)])
    ),
    recommendedNext: stepGuide.recommendedNext,
    writebackRequired: Boolean(target?.writeback?.count),
    projectionDrift: false,
    skillPackDrift: false,
    interviewRound: stepGuide.interviewRound ?? null,
    interviewTarget: stepGuide.interviewTarget ?? null,
    ambiguityPercent: stepGuide.ambiguityPercent ?? null,
    confirmedFacts: stepGuide.confirmedFacts ?? [],
    readinessGates: stepGuide.readinessGates ?? [],
    focusQuestion: stepGuide.focusQuestion ?? null,
    writebackSections: stepGuide.writebackSections ?? [],
    stepAware: true,
    updatedAt: new Date().toISOString()
  };
}

function buildChangeStepGuide({ target, missing, risks, blocking, projectProtocolIssues = [] }) {
  if (!target) {
    return {
      currentPhase: "clarify",
      step: "create_change",
      stepLabel: "先创建 change",
      primaryAction: "specnfc change create <change-id>",
      primaryDoc: null,
      primaryGoal: "先创建一条 change，再进入需求与方案维护。",
      requiredSections: [],
      doNotDoYet: ["不要直接开始写文档或代码", "不要跳过 change 对象创建"],
      exitCriteria: ["change 已创建", "运行 `specnfc change check <change-id>` 获取下一步"],
      afterPrimaryAction: "change 创建后，先补 01-需求与方案.md，再重新执行 check",
      recommendedNext: [{ type: "cli", value: "specnfc change create <change-id>" }]
    };
  }

  if ((target.governance?.invalidCount || 0) > 0) {
    const invalidFiles = (target.governance?.invalidSummary?.samples || [])
      .map((item) => item.file)
      .filter(Boolean)
      .slice(0, 3)
      .map((item) => ({ type: "doc", value: item }));
    return {
      currentPhase: target.canonicalStage,
      step: "fix_governance",
      stepLabel: "先修复治理记录",
      primaryAction: "specnfc doctor --json",
      primaryDoc: invalidFiles[0]?.value ?? null,
      primaryGoal: "先修复无效 governance record，避免门禁和阶段判断失真。",
      requiredSections: [],
      doNotDoYet: ["不要继续推进 change 阶段", "不要跳过治理记录修复"],
      exitCriteria: ["`specnfc doctor --json` 不再报告无效 governance record", `重新运行 \`specnfc change check ${target.id}\` 后阻断消失`],
      afterPrimaryAction: `治理记录修复后，重新运行 \`specnfc change check ${target.id}\``,
      recommendedNext: [...invalidFiles, { type: "cli", value: "specnfc doctor --json" }, { type: "cli", value: `specnfc change check ${target.id}` }]
    };
  }
  if (target.writeback?.count) {
    return {
      currentPhase: target.canonicalStage,
      step: "sync_writeback",
      stepLabel: "先完成写回",
      primaryAction: target.writeback.targetDocs[0] ?? "先完成待回写文档同步",
      primaryDoc: target.writeback.targetDocs[0] ?? null,
      primaryGoal: "先把运行时待回写内容落回正式 dossier，避免文档与状态分叉。",
      requiredSections: [],
      doNotDoYet: ["不要在未写回的情况下继续推进下一阶段"],
      exitCriteria: ["待回写文档已同步", `重新运行 \`specnfc change check ${target.id}\` 后不再出现待回写项`],
      afterPrimaryAction: `写回完成后，重新运行 \`specnfc change check ${target.id}\``,
      recommendedNext: target.writeback.targetDocs.map((item) => ({ type: "doc", value: item }))
    };
  }
  if (projectProtocolIssues.length) {
    return {
      currentPhase: target.canonicalStage,
      step: "fix_project_protocol",
      stepLabel: "先补项目层协议入口",
      primaryAction: "specnfc status --json",
      primaryDoc: projectProtocolIssues[0]?.file ?? null,
      primaryGoal: "先补齐项目层协议文件，保证仓库处于完整协议接管状态。",
      requiredSections: [],
      doNotDoYet: ["不要在项目层协议缺失时继续推进关键阶段"],
      exitCriteria: ["项目层协议问题已补齐", "`specnfc status --json` 不再提示项目协议缺失"],
      afterPrimaryAction: "项目层协议补齐后，再回到当前 change 的 check 结果继续推进",
      recommendedNext: [...projectProtocolIssues.map((item) => ({ type: "doc", value: item.file })), { type: "cli", value: "specnfc status --json" }]
    };
  }

  const riskCodes = new Set((target.risks || []).map((item) => item.code));
  const requirementsReady = isRequirementsAndSolutionReady(target);
  const technicalDecision = target.technicalDesignDecision || buildDefaultTechnicalDesignDecision();
  const technicalReady = !technicalDecision.requiresTechnicalDesign || isTechnicalDesignReady(target);
  const planReady = isPlanAndExecutionReady(target);
  const acceptanceReady = isAcceptanceAndHandoffReady(target);
  const shouldGuideAcceptance = ["verify", "accept", "archive"].includes(target.canonicalStage);

  if (!requirementsReady) {
    const interviewProtocol = buildClarifyInterviewProtocol(target);
    return {
      currentPhase: "clarify",
      step: "clarify_requirements",
      stepLabel: "先完成需求与方案",
      primaryAction: `补充 ${target.docRoles?.requirementsAndSolution ?? CHANGE_DOC_ROLE_FILES.requirementsAndSolution}`,
      primaryDoc: target.docRoles?.requirementsAndSolution ?? CHANGE_DOC_ROLE_FILES.requirementsAndSolution,
      primaryGoal: "先把问题边界、目标范围、方案备选、当前选择与验收口径写清楚。",
      requiredSections: ["问题定义", "目标", "非目标", "范围", "方案备选", "当前选择", "风险与验收口径"],
      doNotDoYet: [
        "不要先维护 `03-任务计划与执行.md`",
        "不要先进入代码实现或测试",
        "不要先补 `04-验收与交接.md`"
      ],
      exitCriteria: [
        "`01-需求与方案.md` 不再是占位内容",
        "已明确范围、当前选择与验收口径",
        `重新运行 \`specnfc change check ${target.id}\` 后进入技术设计或任务计划分流`
      ],
      afterPrimaryAction: `补完 01 后，重新运行 \`specnfc change check ${target.id}\``,
      recommendedNext: [
        { type: "doc", value: target.docRoles?.requirementsAndSolution ?? CHANGE_DOC_ROLE_FILES.requirementsAndSolution },
        { type: "cli", value: `specnfc change check ${target.id}` },
        { type: "skill", value: "需求澄清" }
      ],
      ...interviewProtocol
    };
  }

  if (!technicalReady) {
    const interviewProtocol = buildTechnicalDesignInterviewProtocol(target, technicalDecision);
    return {
      currentPhase: "design",
      step: "technical_design",
      stepLabel: "先完成技术设计与选型",
      primaryAction: `补充 ${target.docRoles?.technicalDesign ?? CHANGE_DOC_ROLE_FILES.technicalDesign}`,
      primaryDoc: target.docRoles?.technicalDesign ?? CHANGE_DOC_ROLE_FILES.technicalDesign,
      primaryGoal: technicalDecision.reason
        ? `当前 change 已触发独立技术设计：${technicalDecision.reason}`
        : "当前 change 已触发独立技术设计，需要先收敛技术约束、候选方案与选型结论。",
      requiredSections: ["触发说明", "技术背景与约束", "候选方案对比", "选型结论", "影响面与验证思路"],
      doNotDoYet: [
        "不要先维护 `03-任务计划与执行.md`",
        "不要直接进入代码实现或测试",
        "不要先补 `04-验收与交接.md`"
      ],
      exitCriteria: [
        "`02-技术设计与选型.md` 不再是占位内容",
        "已明确复杂度、技术约束、候选方案与选型结论",
        `重新运行 \`specnfc change check ${target.id}\` 后才能进入任务计划与执行`
      ],
      afterPrimaryAction: `补完 02 后，重新运行 \`specnfc change check ${target.id}\``,
      recommendedNext: [
        { type: "doc", value: target.docRoles?.technicalDesign ?? CHANGE_DOC_ROLE_FILES.technicalDesign },
        { type: "cli", value: `specnfc change check ${target.id}` },
        { type: "skill", value: "方案设计" }
      ],
      ...interviewProtocol
    };
  }

  if (!planReady) {
    const lowComplexityHint = technicalDecision.requiresTechnicalDesign ? "已完成技术设计，可进入任务计划与执行。" : "当前按低复杂度路径推进，可直接从 01 进入 03。";
    return {
      currentPhase: target.stage === "in-progress" ? "execute" : "plan",
      step: "plan_execution",
      stepLabel: "进入任务计划与执行",
      primaryAction: `补充 ${target.docRoles?.planAndExecution ?? CHANGE_DOC_ROLE_FILES.planAndExecution}`,
      primaryDoc: target.docRoles?.planAndExecution ?? CHANGE_DOC_ROLE_FILES.planAndExecution,
      primaryGoal: `${lowComplexityHint} 先补齐实现计划、任务清单、执行状态与下一步。`,
      requiredSections: ["实现计划", "任务清单", "执行状态", "阻塞项", "下一步", "integration / 协作推进"],
      doNotDoYet: [
        "不要先补 `04-验收与交接.md`",
        "不要跳过任务拆分直接宣称完成"
      ],
      exitCriteria: [
        "`03-任务计划与执行.md` 不再是占位内容",
        "已写清任务拆分、当前状态、阻塞项和下一步",
        `重新运行 \`specnfc change check ${target.id}\` 后进入执行或验收阶段`
      ],
      afterPrimaryAction: `补完 03 后，重新运行 \`specnfc change check ${target.id}\``,
      recommendedNext: [
        { type: "doc", value: target.docRoles?.planAndExecution ?? CHANGE_DOC_ROLE_FILES.planAndExecution },
        { type: "cli", value: `specnfc change check ${target.id}` },
        { type: "skill", value: target.stage === "in-progress" ? "执行落地" : "任务规划" }
      ]
    };
  }

  if (shouldGuideAcceptance && (!acceptanceReady || riskCodes.has("PLACEHOLDER_ACCEPTANCE_AND_HANDOFF"))) {
    return {
      currentPhase: target.stage === "verifying" ? "verify" : "accept",
      step: "acceptance_handoff",
      stepLabel: "完善验收与交接",
      primaryAction: `补充 ${target.docRoles?.acceptanceAndHandoff ?? CHANGE_DOC_ROLE_FILES.acceptanceAndHandoff}`,
      primaryDoc: target.docRoles?.acceptanceAndHandoff ?? CHANGE_DOC_ROLE_FILES.acceptanceAndHandoff,
      primaryGoal: "补齐验证结果、剩余风险、交付交接和提交说明，完成交付闭环。",
      requiredSections: ["验收范围", "验证方式与结果", "剩余风险与结论", "交付与发布交接", "提交说明"],
      doNotDoYet: ["不要在验收与交接未闭合时直接归档"],
      exitCriteria: [
        "`04-验收与交接.md` 不再是占位内容",
        "已给出验证结果、剩余风险与是否允许进入 handoff / archive 的结论",
        `重新运行 \`specnfc change check ${target.id}\` 后进入交付或归档`
      ],
      afterPrimaryAction: `补完 04 后，重新运行 \`specnfc change check ${target.id}\``,
      recommendedNext: [
        { type: "doc", value: target.docRoles?.acceptanceAndHandoff ?? CHANGE_DOC_ROLE_FILES.acceptanceAndHandoff },
        { type: "cli", value: `specnfc change check ${target.id}` },
        { type: "skill", value: "验证验收" }
      ]
    };
  }

  const nextStage = getRecommendedNextLegacyStage({ target, technicalDecision, requirementsReady });
  return {
    currentPhase: target.canonicalStage,
    step: "advance_stage",
    stepLabel: "当前文档已达下一阶段条件",
    primaryAction: `specnfc change stage ${target.id} --to ${nextStage}`,
    primaryDoc: null,
    primaryGoal: "当前四主文档已基本闭合，可以推进 change 阶段。",
    requiredSections: [],
    doNotDoYet: [],
    exitCriteria: [`运行 \`specnfc change stage ${target.id} --to ${nextStage}\` 后阶段已推进`],
    afterPrimaryAction: `阶段推进后，重新运行 \`specnfc change check ${target.id}\` 确认下一步`,
    recommendedNext: [{ type: "cli", value: `specnfc change stage ${target.id} --to ${nextStage}` }]
  };
}

export function buildClarifyInterviewProtocol(target) {
  const openCodes = collectOpenGapCodes(target?.risks);
  return buildInterviewProtocol({
    groups: [
      {
        name: "问题定义与目标",
        sections: ["问题定义", "目标"],
        codes: ["MISSING_REQUIREMENTS_INTENT"],
        confirmed: "问题定义与目标已有初稿",
        question: "这次 change 真正要解决的问题是什么？成功后的结果要如何判断？"
      },
      {
        name: "非目标与范围",
        sections: ["非目标", "范围"],
        codes: ["MISSING_REQUIREMENTS_NON_GOALS", "MISSING_REQUIREMENTS_SCOPE"],
        confirmed: "非目标与范围已初步收敛",
        question: "这次明确不做什么？哪些相邻范围必须显式排除，避免团队误解边界？"
      },
      {
        name: "方案备选与当前选择",
        sections: ["方案备选", "当前选择"],
        codes: ["MISSING_REQUIREMENTS_DECISION"],
        confirmed: "已出现方案备选与当前选择",
        question: "至少有哪些可行方案？当前为什么选这一种，不选另外方案的依据是什么？"
      },
      {
        name: "风险与验收口径",
        sections: ["风险与验收口径"],
        codes: ["MISSING_REQUIREMENTS_ACCEPTANCE"],
        confirmed: "风险与验收口径已有初稿",
        question: "哪些风险需要提前接受或规避？达到什么结果才算本次 change 可以进入下一阶段？"
      }
    ],
    openCodes
  });
}

export function buildTechnicalDesignInterviewProtocol(target, technicalDecision) {
  const openCodes = collectOpenGapCodes(target?.risks);
  const triggerHint = technicalDecision?.reason ? `已确认触发原因：${technicalDecision.reason}` : "已触发独立技术设计";

  return buildInterviewProtocol({
    groups: [
      {
        name: "触发说明与设计边界",
        sections: ["触发说明", "技术背景与约束"],
        codes: ["MISSING_TECHNICAL_TRIGGER", "MISSING_TECHNICAL_CONSTRAINTS"],
        confirmed: triggerHint,
        question: "本次技术设计真正要拍板的边界是什么？哪些现有架构、兼容、安全或发布约束不能被突破？"
      },
      {
        name: "候选方案对比",
        sections: ["候选方案对比"],
        codes: ["MISSING_TECHNICAL_OPTIONS"],
        confirmed: "候选方案已进入正式对比",
        question: "至少要摆出哪些可行技术方案？它们各自的收益、代价和适用条件分别是什么？"
      },
      {
        name: "选型结论与决策边界",
        sections: ["选型结论"],
        codes: ["MISSING_TECHNICAL_SELECTION"],
        confirmed: "当前选型结论已有初稿",
        question: "最终采用哪种方案？放弃其他方案的关键理由与决策边界是什么？"
      },
      {
        name: "影响面与验证思路",
        sections: ["影响面与验证思路"],
        codes: ["MISSING_TECHNICAL_VERIFICATION"],
        confirmed: "影响面与验证思路已有初稿",
        question: "这个设计会影响哪些模块、接口或协作方？要用什么验证手段证明方案成立？"
      }
    ],
    openCodes
  });
}

function buildInterviewProtocol({ groups, openCodes }) {
  const gateStatuses = groups.map((group, index) => {
    const open = group.codes.some((code) => openCodes.has(code));
    return {
      ...group,
      index,
      status: open ? "pending" : "complete"
    };
  });

  const focusGate = gateStatuses.find((item) => item.status !== "complete") || gateStatuses[gateStatuses.length - 1];
  const pendingCount = gateStatuses.filter((item) => item.status !== "complete").length;
  const completedFacts = gateStatuses.filter((item) => item.index < focusGate.index && item.status === "complete").map((item) => item.confirmed);

  return {
    interviewRound: focusGate.index + 1,
    interviewTarget: focusGate.name,
    ambiguityPercent: Math.max(12, Math.round((pendingCount / gateStatuses.length) * 100)),
    confirmedFacts: completedFacts,
    readinessGates: gateStatuses.map((item) => ({
      name: item.name,
      status: item.index === focusGate.index && item.status !== "complete" ? "focus" : item.status
    })),
    focusQuestion: focusGate.question,
    writebackSections: focusGate.sections
  };
}

function collectOpenGapCodes(risks = []) {
  const codes = new Set();
  for (const risk of risks || []) {
    for (const detail of risk?.details || []) {
      if (detail?.code) {
        codes.add(detail.code);
      }
    }
  }
  return codes;
}

function getWorkflowSkillNameByPhase(phase) {
  switch (phase) {
    case "clarify":
      return "需求澄清";
    case "design":
      return "方案设计";
    case "plan":
      return "任务规划";
    case "execute":
      return "执行落地";
    case "verify":
      return "验证验收";
    case "accept":
    case "archive":
      return "交付归档";
    default:
      return "任务规划";
  }
}

function getNextLegacyStage(stage) {
  switch (stage) {
    case "draft":
      return "design";
    case "design":
      return "ready";
    case "ready":
      return "in-progress";
    case "in-progress":
      return "verifying";
    case "verifying":
      return "handoff";
    case "handoff":
      return "archived";
    default:
      return "design";
  }
}

function getRecommendedNextLegacyStage({ target, technicalDecision, requirementsReady }) {
  if (
    target?.stage === "draft" &&
    requirementsReady &&
    technicalDecision &&
    technicalDecision.requiresTechnicalDesign === false
  ) {
    return "ready";
  }

  if (target?.stage === "design" && technicalDecision && technicalDecision.requiresTechnicalDesign === false) {
    return "ready";
  }

  return getNextLegacyStage(target?.stage);
}

async function assertChangeGovernanceGate({ repoRoot, changeId, toStage }) {
  const governance = await inspectGovernanceTarget({
    repoRoot,
    scope: "change",
    targetId: changeId
  });

  if ((governance.invalidCount || 0) > 0 && ["verifying", "handoff"].includes(toStage)) {
    throw new ChangeWorkflowError("PRECONDITION_FAILED", "进入治理门禁阶段前必须先修复无效 governance record");
  }

  if (toStage === "verifying") {
    if (!governance.gateSummary.hasReview) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", "进入 verifying 前至少需要 1 条 review-record");
    }

    if (governance.gateSummary.hasRejectedReview) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", "进入 verifying 前存在 verdict=rejected 的 review-record");
    }
  }

  if (toStage === "handoff") {
    if (!governance.gateSummary.hasPassedVerification) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", "进入 handoff 前至少需要 1 条 verification-record，且 result=passed");
    }

    if (!governance.gateSummary.hasApprovedApproval) {
      throw new ChangeWorkflowError("PRECONDITION_FAILED", "进入 handoff 前至少需要 1 条 approval-record，且 decision=approved");
    }
  }
}

async function loadChange(repoRoot, rawChangeId) {
  const repoPaths = getRepoPaths(repoRoot);
  const changeId = normalizeChangeId(rawChangeId);
  const changeRoot = resolvePathWithin(repoPaths.changesRoot, changeId);
  await assertPathInsideRoot(repoRoot, changeRoot);

  if (!(await isDirectory(changeRoot))) {
    throw new ChangeWorkflowError("CHANGE_NOT_FOUND", `未找到 change：${changeId}`);
  }

  const metaPath = resolvePathWithin(changeRoot, "meta.json");
  await assertPathInsideRoot(repoRoot, metaPath);
  if (!(await pathExists(metaPath))) {
    throw new ChangeWorkflowError("WRITE_DENIED", `change 缺少元信息文件：${toRelative(repoRoot, metaPath)}`);
  }

  let meta;
  try {
    meta = await readJson(metaPath);
  } catch {
    throw new ChangeWorkflowError("WRITE_DENIED", `change 元信息无法解析：${toRelative(repoRoot, metaPath)}`);
  }

  if (meta.id && meta.id !== changeId) {
    throw new ChangeWorkflowError("WRITE_DENIED", "元信息 ID 与目录不一致，拒绝继续处理");
  }

  return {
    changeId,
    changeRoot,
    metaPath,
    meta
  };
}

function getChangeStructure(config) {
  const configured = config.defaults?.changeStructure;
  return Array.isArray(configured) && configured.length ? configured : DEFAULT_CHANGE_FILES;
}

function getDeliveryChangeFiles(config) {
  if (!config.modules?.delivery?.enabled) {
    return [];
  }

  if (usesMergedChangeDocs(config)) {
    return [];
  }

  return DELIVERY_CHANGE_FILES;
}

function getGovernanceEvidenceRelativeDirs() {
  return ["evidence/reviews", "evidence/approvals", "evidence/verifications"];
}

async function ensureGovernanceEvidenceDirs(changeRoot) {
  for (const relativeDir of getGovernanceEvidenceRelativeDirs()) {
    await ensureDir(path.join(changeRoot, relativeDir));
  }
}

async function syncDeliveryChecklistForStage(changeRoot, meta, options = {}) {
  const deliveryChecklistPath = resolvePathWithin(changeRoot, "delivery-checklist.md");
  if (!(await pathExists(deliveryChecklistPath))) {
    return;
  }

  const content = await readText(deliveryChecklistPath);
  let nextContent = content.replace(/- 当前阶段：`[^`]*`/, `- 当前阶段：\`${meta.stage}\``);

  if (options.markHandoff) {
    nextContent = nextContent.replace(
      "- [ ] 如需发布交接，`release-handoff.md` 已补齐",
      "- [x] 如需发布交接，`release-handoff.md` 已补齐"
    );
  }

  if (options.markArchived) {
    nextContent = nextContent.replace(
      "- [ ] 当前变更已完成交付，可进入归档",
      "- [x] 当前变更已完成交付，可进入归档"
    );
  }

  await writeText(deliveryChecklistPath, nextContent);
}

async function inspectChangeIntegrationDependencies({
  repoRoot,
  changeRoot,
  structure,
  integrationIndex
}) {
  const refs = await collectIntegrationRefsFromChange({ changeRoot, structure });
  const index = integrationIndex ?? (await getIntegrationIndex({ repoRoot }));
  const issues = [];
  const blocked = [];

  for (const integrationId of refs) {
    const integration = index.get(integrationId);
    if (!integration) {
      issues.push({
        code: "INTEGRATION_NOT_FOUND",
        message: `change 依赖的对接不存在：${integrationId}`
      });
      blocked.push({
        id: integrationId,
        status: "missing"
      });
      continue;
    }

    if (!isIntegrationReadyForImplementation(integration.status)) {
      issues.push({
        code: "INTEGRATION_NOT_READY",
        message: `change 依赖的对接尚未就绪：${integrationId}（当前状态：${integration.status}）`
      });
      blocked.push({
        id: integrationId,
        status: integration.status
      });
    }
  }

  return {
    refs,
    issues,
    blocked
  };
}

async function collectIntegrationRefsFromChange({ changeRoot, structure }) {
  const refs = new Set();
  const candidates = Array.from(
    new Set(
      (structure || [])
        .filter((fileName) => fileName.endsWith(".md"))
        .concat(["spec.md", "design.md", "plan.md", "tasks.md", ...DEFAULT_CHANGE_FILES])
    )
  );

  for (const fileName of candidates) {
    const targetPath = resolvePathWithin(changeRoot, fileName);
    if (!(await pathExists(targetPath))) {
      continue;
    }

    const content = await readText(targetPath);
    for (const pattern of INTEGRATION_REFERENCE_PATTERNS) {
      for (const match of content.matchAll(pattern)) {
        const normalized = normalizeChangeReferenceId(match[1]);
        if (normalized) {
          refs.add(normalized);
        }
      }
    }
  }

  return Array.from(refs).sort();
}

async function buildChangeHandoffSummary({ repoRoot, changeRoot, changeId, config, meta }) {
  const structure = getChangeStructure(config);
  const integrationRefs = await collectIntegrationRefsFromChange({ changeRoot, structure });
  const integrationIndex = await getIntegrationIndex({ repoRoot });
  const linkedIntegrations = integrationRefs.map((id) => integrationIndex.get(id)).filter(Boolean);
  const delivery = await evaluateDeliveryState({
    changeRoot,
    meta,
    config,
    repoRoot
  });

  const requirementsSummary = meta?.docRoles?.requirementsAndSolution
    ? await summarizeChangeFile(changeRoot, meta.docRoles.requirementsAndSolution)
    : await summarizeChangeFile(changeRoot, "proposal.md");
  const technicalSummary = meta?.docRoles?.technicalDesign
    ? await summarizeChangeFile(changeRoot, meta.docRoles.technicalDesign)
    : await summarizeChangeFile(changeRoot, "design.md");
  const executionSummary = meta?.docRoles?.planAndExecution
    ? await summarizeChangeFile(changeRoot, meta.docRoles.planAndExecution)
    : await summarizeChangeFile(changeRoot, "status.md");
  const deliverySummary = meta?.docRoles?.acceptanceAndHandoff
    ? await summarizeChangeFile(changeRoot, meta.docRoles.acceptanceAndHandoff)
    : await summarizeChangeFile(changeRoot, "acceptance.md");

  const summaryLines = compactTextLines([
    requirementsSummary ? `问题与目标：${requirementsSummary}` : null,
    technicalSummary ? `技术方案：${technicalSummary}` : null,
    executionSummary ? `当前执行：${executionSummary}` : null
  ]);

  const impactLines = compactTextLines([
    technicalSummary ? `设计影响：${technicalSummary}` : null,
    integrationRefs.length ? `关联对接：${integrationRefs.map((item) => `\`${item}\``).join("、")}` : "关联对接：当前无",
    linkedIntegrations.length
      ? `对接状态：${linkedIntegrations.map((item) => `${item.id}（${item.status}）`).join("、")}`
      : null
  ]);

  const riskLines = compactTextLines([
    executionSummary ? `执行风险与阻断：${executionSummary}` : null,
    deliverySummary ? `验收与交接：${deliverySummary}` : null,
    delivery.enabled ? `交付状态：${delivery.summary}` : null
  ]);

  const rollbackLines = compactTextLines([
    `回退入口：按 change-id \`${changeId}\` 回退相关实现与配置变更`,
    integrationRefs.length ? `回退前确认关联对接：${integrationRefs.join("、")}` : "回退前确认当前仓无额外对接依赖",
    "回退后重新执行 `specnfc doctor` 与 `specnfc status` 确认仓状态"
  ]);

  const verificationLines = compactTextLines([
    delivery.enabled ? `交付校验：${delivery.summary}` : "交付校验：当前未启用 delivery 模块",
    integrationRefs.length
      ? `对接校验：${linkedIntegrations.map((item) => `${item.id}=${item.status}`).join("、")}`
      : "对接校验：当前无关联 integration",
    "建议在交接后执行：`specnfc change archive <change-id>`"
  ]);

  return {
    integrationRefs,
    deliverySummary: delivery.summary,
    summaryLines,
    impactLines,
    riskLines,
    rollbackLines,
    verificationLines
  };
}

async function summarizeChangeFile(changeRoot, fileName) {
  const targetPath = resolvePathWithin(changeRoot, fileName);
  if (!(await pathExists(targetPath))) {
    return "";
  }

  const content = await readText(targetPath);
  return firstMeaningfulMarkdownText(content);
}

function firstMeaningfulMarkdownText(content) {
  const lines = String(content || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .filter((line) => !line.startsWith("```"))
    .filter((line) => !/^(TODO|待补充|占位)/i.test(line))
    .map((line) => line.replace(/^[-*]\s*/, "").replace(/^\d+\.\s*/, ""))
    .filter(Boolean);

  return lines.slice(0, 2).join("；");
}

function compactTextLines(items) {
  return items.filter((item) => item && String(item).trim() && !String(item).includes("当前无；"));
}

function toMarkdownBullets(items, fallbackLine) {
  const normalized = items?.length ? items : [fallbackLine];
  return normalized.map((item) => (item.trim().startsWith("-") ? item : `- ${item}`)).join("\n");
}

function normalizeChangeReferenceId(rawValue) {
  return String(rawValue ?? "")
    .trim()
    .replace(/^`|`$/g, "")
    .replace(/[，。；;,.]$/g, "")
    .toLowerCase();
}

function isIntegrationReadyForImplementation(status) {
  return ["aligned", "implementing", "integrating", "done"].includes(status);
}

async function evaluateDeliveryState({ changeRoot, meta, config, repoRoot }) {
  if (!config.modules?.delivery?.enabled) {
    return {
      enabled: false,
      status: "disabled",
      summary: "未启用",
      action: "当前无",
      issues: []
    };
  }

  if (meta?.docRoles?.acceptanceAndHandoff) {
    const issues = [];
    const mergedPath = getChangeDocPath(changeRoot, meta, "acceptanceAndHandoff");

    if (!(await pathExists(mergedPath))) {
      issues.push({
        code: "MISSING_ACCEPTANCE_AND_HANDOFF",
        message: `change 已启用 delivery，但缺少 04-验收与交接.md：${toRelative(repoRoot, mergedPath)}`
      });
    } else {
      const content = await readText(mergedPath);

      if (isPlaceholderAcceptanceAndHandoff(content)) {
        issues.push({
          code: "PLACEHOLDER_ACCEPTANCE_AND_HANDOFF",
          message: `04-验收与交接.md 仍是占位内容：${toRelative(repoRoot, mergedPath)}`
        });
      }

      for (const section of ["## 验收范围", "## 验证方式与结果", "## 剩余风险与结论", "## 交付与发布交接", "## 提交说明"]) {
        if (!content.includes(section)) {
          issues.push({
            code: "INCOMPLETE_ACCEPTANCE_AND_HANDOFF",
            message: `04-验收与交接.md 缺少关键章节 ${section}：${toRelative(repoRoot, mergedPath)}`
          });
          break;
        }
      }
    }

    const codes = new Set(issues.map((item) => item.code));
    let status = "ready";
    let summary = "可推送";
    let action = "当前无";

    if (codes.has("MISSING_ACCEPTANCE_AND_HANDOFF")) {
      status = "missing";
      summary = "缺验收与交接主文档";
      action = "先补 04-验收与交接.md";
    } else if (codes.has("PLACEHOLDER_ACCEPTANCE_AND_HANDOFF") || codes.has("INCOMPLETE_ACCEPTANCE_AND_HANDOFF")) {
      status = "prepared";
      summary = "验收与交接待完善";
      action = "先完善 04-验收与交接.md";
    } else if (meta.stage === "archived") {
      status = "archived";
      summary = "已归档";
    } else if (meta.stage === "handoff") {
      status = "ready";
      summary = "可交接";
      action = "可归档";
    }

    return {
      enabled: true,
      status,
      summary,
      action,
      issues
    };
  }

  const issues = [];
  const commitMessagePath = resolvePathWithin(changeRoot, "commit-message.md");
  const deliveryChecklistPath = resolvePathWithin(changeRoot, "delivery-checklist.md");
  const acceptancePath = resolvePathWithin(changeRoot, "acceptance.md");
  const handoffPath = resolvePathWithin(changeRoot, "release-handoff.md");

  if (!(await pathExists(commitMessagePath))) {
    issues.push({
      code: "MISSING_COMMIT_MESSAGE",
      message: `change 已启用 delivery，但缺少 commit-message.md：${toRelative(repoRoot, commitMessagePath)}`
    });
  }

  if (!(await pathExists(deliveryChecklistPath))) {
    issues.push({
      code: "MISSING_DELIVERY_CHECKLIST",
      message: `change 已启用 delivery，但缺少 delivery-checklist.md：${toRelative(repoRoot, deliveryChecklistPath)}`
    });
  } else {
    const deliveryChecklist = await readText(deliveryChecklistPath);

    if (!deliveryChecklist.includes(`- 当前阶段：\`${meta.stage}\``)) {
      issues.push({
        code: "STALE_DELIVERY_STAGE",
        message: `delivery-checklist.md 的阶段未同步到 ${meta.stage}：${toRelative(repoRoot, deliveryChecklistPath)}`
      });
    }

    if (["handoff", "archived"].includes(meta.stage) && !deliveryChecklist.includes("- [x] 如需发布交接，`release-handoff.md` 已补齐")) {
      issues.push({
        code: "DELIVERY_HANDOFF_UNCONFIRMED",
        message: `change 已进入 ${meta.stage} 阶段，但 delivery-checklist.md 尚未确认交接项：${toRelative(repoRoot, deliveryChecklistPath)}`
      });
    }

    if (meta.stage === "archived" && !deliveryChecklist.includes("- [x] 当前变更已完成交付，可进入归档")) {
      issues.push({
        code: "DELIVERY_ARCHIVE_UNCONFIRMED",
        message: `change 已归档，但 delivery-checklist.md 尚未确认归档项：${toRelative(repoRoot, deliveryChecklistPath)}`
      });
    }
  }

  if ((await pathExists(commitMessagePath))) {
    const commitMessage = await readText(commitMessagePath);
    if (
      commitMessage.includes("<type>: <change-id> <一句话说明>") ||
      /Summary:\s*\n-\s*\n/.test(commitMessage) ||
      /Risks:\s*\n-\s*\n/.test(commitMessage) ||
      /Validation:\s*\n-\s*\n/.test(commitMessage)
    ) {
      issues.push({
        code: "PLACEHOLDER_COMMIT_MESSAGE",
        message: `commit-message.md 仍是占位内容：${toRelative(repoRoot, commitMessagePath)}`
      });
    }
  }

  if ((await pathExists(deliveryChecklistPath))) {
    const deliveryChecklist = await readText(deliveryChecklistPath);
    const checkedCount = (deliveryChecklist.match(/- \[x\]/g) || []).length;
    if (checkedCount === 0) {
      issues.push({
        code: "UNSTARTED_DELIVERY_CHECKLIST",
        message: `delivery-checklist.md 仍未开始填写：${toRelative(repoRoot, deliveryChecklistPath)}`
      });
    }
  }

  if (["verifying", "handoff", "archived"].includes(meta.stage)) {
    if (!(await pathExists(acceptancePath))) {
      issues.push({
        code: "MISSING_ACCEPTANCE",
        message: `change 已进入 ${meta.stage} 阶段，但缺少 acceptance.md：${toRelative(repoRoot, acceptancePath)}`
      });
    } else {
      const acceptance = await readText(acceptancePath);
      if (isPlaceholderAcceptance(acceptance)) {
        issues.push({
          code: "PLACEHOLDER_ACCEPTANCE",
          message: `acceptance.md 仍是占位内容：${toRelative(repoRoot, acceptancePath)}`
        });
      }
      if (!acceptance.includes("## 结论")) {
        issues.push({
          code: "MISSING_ACCEPTANCE_CONCLUSION",
          message: `acceptance.md 缺少结论段：${toRelative(repoRoot, acceptancePath)}`
        });
      }
    }
  }

  if (["handoff", "archived"].includes(meta.stage)) {
    if (!(await pathExists(handoffPath))) {
      issues.push({
        code: "MISSING_HANDOFF",
        message: `change 已进入 ${meta.stage} 阶段，但缺少 release-handoff.md：${toRelative(repoRoot, handoffPath)}`
      });
    } else {
      const handoff = await readText(handoffPath);
      for (const section of ["## 变更摘要", "## 发布关注点", "## 风险说明", "## 回退提示", "## 验证与交接状态"]) {
        if (!handoff.includes(section)) {
          issues.push({
            code: "INCOMPLETE_RELEASE_HANDOFF",
            message: `release-handoff.md 缺少关键章节 ${section}：${toRelative(repoRoot, handoffPath)}`
          });
          break;
        }
      }
    }
  }

  let status = "ready";
  let summary = "可推送";
  let action = "当前无";
  const codes = new Set(issues.map((item) => item.code));

  if (codes.has("MISSING_COMMIT_MESSAGE") || codes.has("MISSING_DELIVERY_CHECKLIST")) {
    status = "missing";
    summary = "缺交付文件";
    action = "先补交付文件";
  } else if (codes.has("STALE_DELIVERY_STAGE") || codes.has("DELIVERY_HANDOFF_UNCONFIRMED") || codes.has("DELIVERY_ARCHIVE_UNCONFIRMED")) {
    status = "out_of_sync";
    summary = "交付状态未同步";
    action = meta.stage === "archived" ? "先同步归档状态" : "先同步交付状态";
  } else if (
    codes.has("MISSING_ACCEPTANCE") ||
    codes.has("PLACEHOLDER_ACCEPTANCE") ||
    codes.has("MISSING_ACCEPTANCE_CONCLUSION") ||
    codes.has("INCOMPLETE_RELEASE_HANDOFF")
  ) {
    status = "out_of_sync";
    summary = "交付材料未闭合";
    action = codes.has("MISSING_ACCEPTANCE") || codes.has("PLACEHOLDER_ACCEPTANCE") ? "先补 acceptance.md" : "先补 release-handoff.md";
  } else if (codes.has("PLACEHOLDER_COMMIT_MESSAGE") || codes.has("UNSTARTED_DELIVERY_CHECKLIST")) {
    status = "prepared";
    summary = "待完善";
    action = codes.has("PLACEHOLDER_COMMIT_MESSAGE") ? "先补提交说明" : "先更新交付自检";
  } else if (meta.stage === "archived") {
    status = "archived";
    summary = "已归档";
  } else if (meta.stage === "handoff") {
    status = "ready";
    summary = "可交接";
    action = "可归档";
  }

  return {
    enabled: true,
    status,
    summary,
    action,
    issues
  };
}

function evaluateMaturityState({ meta, delivery, issues }) {
  const codes = new Set((issues || []).map((item) => item.code));
  const gaps = collectMaturityGaps(issues);

  if (!meta) {
    return {
      status: "unknown",
      summary: "未知",
      action: "先修复元信息",
      gaps
    };
  }

  if (codes.has("MISSING_META") || codes.has("INVALID_META")) {
    return {
      status: "broken",
      summary: "元信息异常",
      action: "先修复元信息",
      gaps
    };
  }

  if (
    codes.has("PLACEHOLDER_REQUIREMENTS_AND_SOLUTION") ||
    codes.has("PLACEHOLDER_TECHNICAL_DESIGN") ||
    codes.has("PLACEHOLDER_PLAN_AND_EXECUTION") ||
    codes.has("PLACEHOLDER_ACCEPTANCE_AND_HANDOFF") ||
    codes.has("PLACEHOLDER_PROPOSAL") ||
    codes.has("PLACEHOLDER_DESIGN") ||
    codes.has("PLACEHOLDER_SPEC") ||
    codes.has("PLACEHOLDER_PLAN")
  ) {
    return {
      status: "draft",
      summary: "待补规格",
      action: gaps.length ? describePrimaryGapAction(gaps) : "先补 proposal / design / spec / plan",
      gaps
    };
  }

  if (
    codes.has("PLACEHOLDER_CAPABILITIES") ||
    codes.has("PLACEHOLDER_SPEC_DELTAS") ||
    codes.has("PLACEHOLDER_DECISIONS") ||
    codes.has("PLACEHOLDER_STATUS")
  ) {
    return {
      status: "incomplete",
      summary: "待补细节",
      action: "先补能力 / 增量 / 决策 / 状态",
      gaps
    };
  }

  if (meta.stage === "handoff") {
    return {
      status: "handoff",
      summary: "可交接",
      action: delivery?.action && delivery.action !== "当前无" ? delivery.action : "可归档",
      gaps
    };
  }

  if (meta.stage === "archived") {
    return {
      status: "archived",
      summary: "已归档",
      action: "当前无",
      gaps
    };
  }

  if (["in-progress", "verifying"].includes(meta.stage)) {
    return {
      status: "implementation",
      summary: "实现中",
      action: delivery?.action && delivery.action !== "当前无" ? delivery.action : "继续实现与验证",
      gaps
    };
  }

  return {
    status: "ready",
    summary: "可实现",
    action: delivery?.action && delivery.action !== "当前无" ? delivery.action : "开始实现",
    gaps
  };
}

function buildSpecPlaceholderIssue({ content, relative }) {
  const details = [];

  if (content.includes("- 本次包含：") || content.includes("- 本次不包含：")) {
    details.push(createGapDetail({
      code: "MISSING_SPEC_SCOPE",
      file: relative,
      section: "范围",
      action: "补范围定义"
    }));
  }

  if (content.includes("- [ ] 验收点 1") || content.includes("- [ ] 验收点 2")) {
    details.push(createGapDetail({
      code: "MISSING_SPEC_ACCEPTANCE",
      file: relative,
      section: "验收标准",
      action: "补验收标准"
    }));
  }

  if (
    content.includes("说明为什么现在要做这项变更") ||
    content.includes("- 前端：\n- 后端：") ||
    details.length
  ) {
    return createPlaceholderIssue({
      code: "PLACEHOLDER_SPEC",
      relative,
      message: details.length ? `spec.md 仍缺关键规格项：${relative}` : `spec.md 仍是占位内容：${relative}`,
      action: details.length ? "先补 `spec.md` 的范围和验收标准" : "先补 `spec.md`",
      details
    });
  }

  return null;
}

function buildRequirementsAndSolutionPlaceholderIssue({ content, relative }) {
  const details = [];

  if (content.includes("说明这次 change 要解决的核心问题") || hasEmptyBulletPlaceholder(content, "目标 1")) {
    details.push(createGapDetail({
      code: "MISSING_REQUIREMENTS_INTENT",
      file: relative,
      section: "问题定义 / 目标",
      action: "补问题定义与目标"
    }));
  }

  if (hasEmptyBulletPlaceholder(content, "本次不做 1") || hasEmptyBulletPlaceholder(content, "本次不做 2")) {
    details.push(createGapDetail({
      code: "MISSING_REQUIREMENTS_NON_GOALS",
      file: relative,
      section: "非目标",
      action: "补非目标与边界"
    }));
  }

  if (hasEmptyBulletPlaceholder(content, "本次包含") || hasEmptyBulletPlaceholder(content, "本次不包含")) {
    details.push(createGapDetail({
      code: "MISSING_REQUIREMENTS_SCOPE",
      file: relative,
      section: "范围",
      action: "补需求边界与范围"
    }));
  }

  if (
    hasEmptyBulletPlaceholder(content, "做法") ||
    hasEmptyBulletPlaceholder(content, "优点") ||
    hasEmptyBulletPlaceholder(content, "风险") ||
    hasEmptyBulletPlaceholder(content, "当前选择") ||
    hasEmptyBulletPlaceholder(content, "选择理由")
  ) {
    details.push(createGapDetail({
      code: "MISSING_REQUIREMENTS_DECISION",
      file: relative,
      section: "方案备选 / 当前选择",
      action: "补方案备选与当前选择"
    }));
  }

  if (hasEmptyBulletPlaceholder(content, "验收口径")) {
    details.push(createGapDetail({
      code: "MISSING_REQUIREMENTS_ACCEPTANCE",
      file: relative,
      section: "验收口径",
      action: "补验收口径"
    }));
  }

  if (
    content.includes("说明这次 change 要解决的核心问题") ||
    hasEmptyBulletPlaceholder(content, "当前选择") ||
    hasEmptyBulletPlaceholder(content, "选择理由") ||
    details.length
  ) {
    return createPlaceholderIssue({
      code: "PLACEHOLDER_REQUIREMENTS_AND_SOLUTION",
      relative,
      message: details.length ? `01-需求与方案.md 仍缺关键项：${relative}` : `01-需求与方案.md 仍是占位内容：${relative}`,
      action: details.length ? "先补 `01-需求与方案.md` 的范围和验收口径" : "先补 `01-需求与方案.md`",
      details
    });
  }

  return null;
}

function buildDesignPlaceholderIssue({ content, relative }) {
  const details = [];

  if (
    content.includes("- 兼容性：") ||
    content.includes("- 安全性：") ||
    content.includes("- 性能：") ||
    content.includes("- 发布：")
  ) {
    details.push(createGapDetail({
      code: "MISSING_DESIGN_CONSTRAINTS",
      file: relative,
      section: "边界与约束",
      action: "补设计约束"
    }));
  }

  if (
    content.includes("- 如何证明设计成立：") ||
    content.includes("- 哪些风险需要重点验证：")
  ) {
    details.push(createGapDetail({
      code: "MISSING_DESIGN_VERIFICATION",
      file: relative,
      section: "验证思路",
      action: "补设计验证思路"
    }));
  }

  if (
    content.includes("说明本次 change 的主要结构") ||
    content.includes("- 输入：") ||
    details.length
  ) {
    return createPlaceholderIssue({
      code: "PLACEHOLDER_DESIGN",
      relative,
      message: details.length ? `design.md 仍缺关键设计项：${relative}` : `design.md 仍是占位内容：${relative}`,
      action: details.length ? "先补 `design.md` 的边界与约束和验证思路" : "先补 `design.md`",
      details
    });
  }

  return null;
}

function buildTechnicalDesignPlaceholderIssue({ content, relative }) {
  const details = [];

  if (
    content.includes("- 复杂度：低 / 中 / 高") ||
    hasEmptyBulletPlaceholder(content, "是否涉及架构取舍") ||
    hasEmptyBulletPlaceholder(content, "是否涉及技术选型")
  ) {
    details.push(createGapDetail({
      code: "MISSING_TECHNICAL_TRIGGER",
      file: relative,
      section: "触发说明",
      action: "补触发说明与独立设计理由"
    }));
  }

  if (
    hasEmptyBulletPlaceholder(content, "兼容性约束") ||
    hasEmptyBulletPlaceholder(content, "安全性约束") ||
    hasEmptyBulletPlaceholder(content, "性能约束")
  ) {
    details.push(createGapDetail({
      code: "MISSING_TECHNICAL_CONSTRAINTS",
      file: relative,
      section: "技术约束",
      action: "补技术约束"
    }));
  }

  if (
    hasEmptyBulletPlaceholder(content, "做法") ||
    hasEmptyBulletPlaceholder(content, "优点") ||
    hasEmptyBulletPlaceholder(content, "风险") ||
    hasEmptyBulletPlaceholder(content, "适用条件")
  ) {
    details.push(createGapDetail({
      code: "MISSING_TECHNICAL_OPTIONS",
      file: relative,
      section: "候选方案对比",
      action: "补候选方案对比与结论"
    }));
  }

  if (
    hasEmptyBulletPlaceholder(content, "当前选择") ||
    hasEmptyBulletPlaceholder(content, "选择理由") ||
    hasEmptyBulletPlaceholder(content, "放弃其他方案的原因")
  ) {
    details.push(createGapDetail({
      code: "MISSING_TECHNICAL_SELECTION",
      file: relative,
      section: "选型结论",
      action: "补选型结论与决策边界"
    }));
  }

  if (
    hasEmptyBulletPlaceholder(content, "模块影响面") ||
    hasEmptyBulletPlaceholder(content, "数据 / 接口影响面") ||
    hasEmptyBulletPlaceholder(content, "integration 影响面") ||
    hasEmptyBulletPlaceholder(content, "如何证明设计成立") ||
    hasEmptyBulletPlaceholder(content, "哪些风险需要重点验证")
  ) {
    details.push(createGapDetail({
      code: "MISSING_TECHNICAL_VERIFICATION",
      file: relative,
      section: "影响面与验证思路",
      action: "补影响面与验证思路"
    }));
  }

  if (
    hasEmptyBulletPlaceholder(content, "如不触发独立技术设计，请在此说明原因") ||
    details.length
  ) {
    return createPlaceholderIssue({
      code: "PLACEHOLDER_TECHNICAL_DESIGN",
      relative,
      message: details.length ? `02-技术设计与选型.md 仍缺关键项：${relative}` : `02-技术设计与选型.md 仍是占位内容：${relative}`,
      action: details.length ? "先补 `02-技术设计与选型.md` 的约束、候选方案与结论" : "先补 `02-技术设计与选型.md`",
      details
    });
  }

  return null;
}

function buildPlanPlaceholderIssue({ content, relative }) {
  const details = [];

  if (content.includes("- 风险 1：") || content.includes("- 风险 2：")) {
    details.push(createGapDetail({
      code: "MISSING_PLAN_RISKS",
      file: relative,
      section: "关键风险",
      action: "补关键风险"
    }));
  }

  if (
    content.includes("- 单元测试：") ||
    content.includes("- 集成测试：") ||
    content.includes("- 手工验证：")
  ) {
    details.push(createGapDetail({
      code: "MISSING_PLAN_VALIDATION",
      file: relative,
      section: "验证计划",
      action: "补验证计划"
    }));
  }

  if (
    content.includes("说明本次 change 的实现思路") ||
    content.includes("- 兼容性约束：") ||
    details.length
  ) {
    return createPlaceholderIssue({
      code: "PLACEHOLDER_PLAN",
      relative,
      message: details.length ? `plan.md 仍缺关键计划项：${relative}` : `plan.md 仍是占位内容：${relative}`,
      action: details.length ? "先补 `plan.md` 的关键风险和验证计划" : "先补 `plan.md`",
      details
    });
  }

  return null;
}

function buildPlanAndExecutionPlaceholderIssue({ content, relative }) {
  const details = [];

  if (content.includes("- 当前结论：") || content.includes("- 最近更新：")) {
    details.push(createGapDetail({
      code: "MISSING_EXECUTION_STATUS",
      file: relative,
      section: "执行状态",
      action: "补当前结论与最近更新"
    }));
  }

  if (content.includes("- 下一步 1：") || content.includes("- 下一步 2：")) {
    details.push(createGapDetail({
      code: "MISSING_EXECUTION_NEXT",
      file: relative,
      section: "下一步",
      action: "补下一步推进动作"
    }));
  }

  if (
    content.includes("- [ ] 完成 `01-需求与方案.md`") ||
    details.length
  ) {
    return createPlaceholderIssue({
      code: "PLACEHOLDER_PLAN_AND_EXECUTION",
      relative,
      message: details.length ? `03-任务计划与执行.md 仍缺关键项：${relative}` : `03-任务计划与执行.md 仍是占位内容：${relative}`,
      action: details.length ? "先补 `03-任务计划与执行.md` 的任务、状态与下一步" : "先补 `03-任务计划与执行.md`",
      details
    });
  }

  return null;
}

function createPlaceholderIssue({ code, relative, message, action, details = [] }) {
  return {
    code,
    message,
    file: relative,
    action,
    details
  };
}

function createGapDetail({ code, file, section, action }) {
  return {
    code,
    file,
    section,
    action
  };
}

function hasEmptyBulletPlaceholder(content, label) {
  return new RegExp(`-\\s*${escapeRegExp(label)}\\s*[：:]\\s*$`, "m").test(String(content || ""));
}

function collectMaturityGaps(issues = []) {
  const gaps = [];
  const seen = new Set();

  for (const issue of issues) {
    for (const detail of issue?.details || []) {
      if (!detail?.code || seen.has(detail.code)) {
        continue;
      }
      seen.add(detail.code);
      gaps.push(detail);
    }
  }

  return gaps;
}

function describePrimaryGapAction(gaps = []) {
  const codes = new Set(gaps.map((item) => item.code));

  if (codes.has("MISSING_REQUIREMENTS_SCOPE") || codes.has("MISSING_REQUIREMENTS_ACCEPTANCE")) {
    return "先补 `01-需求与方案.md` 的范围和验收口径";
  }

  if (codes.has("MISSING_TECHNICAL_CONSTRAINTS") || codes.has("MISSING_TECHNICAL_OPTIONS")) {
    return "先补 `02-技术设计与选型.md` 的约束、候选方案与结论";
  }

  if (codes.has("MISSING_EXECUTION_STATUS") || codes.has("MISSING_EXECUTION_NEXT")) {
    return "先补 `03-任务计划与执行.md` 的任务、状态与下一步";
  }

  if (codes.has("MISSING_SPEC_SCOPE") || codes.has("MISSING_SPEC_ACCEPTANCE")) {
    return "先补 `spec.md` 的范围和验收标准";
  }

  if (codes.has("MISSING_DESIGN_CONSTRAINTS") || codes.has("MISSING_DESIGN_VERIFICATION")) {
    return "先补 `design.md` 的边界与约束和验证思路";
  }

  if (codes.has("MISSING_PLAN_RISKS") || codes.has("MISSING_PLAN_VALIDATION")) {
    return "先补 `plan.md` 的关键风险和验证计划";
  }

  return "先补 proposal / design / spec / plan";
}

function buildDefaultTechnicalDesignDecision() {
  return {
    complexity: "low",
    architectureTradeoff: false,
    technologySelection: false,
    requiresTechnicalDesign: false,
    skipReason: "",
    reason: ""
  };
}

function analyzeTechnicalDesignDecision({ technicalDesignContent }) {
  if (!technicalDesignContent) {
    return buildDefaultTechnicalDesignDecision();
  }

  const complexity = extractTechnicalDesignField(technicalDesignContent, "复杂度")?.toLowerCase() || "low";
  const architectureTradeoff = isAffirmativeValue(extractTechnicalDesignField(technicalDesignContent, "是否涉及架构取舍"));
  const technologySelection = isAffirmativeValue(extractTechnicalDesignField(technicalDesignContent, "是否涉及技术选型"));
  const skipReason = extractTechnicalDesignField(technicalDesignContent, "如不触发独立技术设计，请在此说明原因");
  const normalizedComplexity = normalizeTechnicalComplexity(complexity);
  const requiresTechnicalDesign = normalizedComplexity !== "low" || architectureTradeoff || technologySelection;

  let reason = "";
  if (normalizedComplexity !== "low") {
    reason = `复杂度为${normalizedComplexity === "high" ? "高" : "中"}`;
  } else if (architectureTradeoff) {
    reason = "涉及架构取舍";
  } else if (technologySelection) {
    reason = "涉及技术选型";
  } else if (skipReason) {
    reason = `已声明不触发独立技术设计：${skipReason}`;
  } else {
    reason = "当前按低复杂度路径推进";
  }

  return {
    complexity: normalizedComplexity,
    architectureTradeoff,
    technologySelection,
    requiresTechnicalDesign,
    skipReason,
    reason
  };
}

function pruneOptionalTechnicalDesignArtifacts({
  repoRoot,
  changeRoot,
  meta,
  missing = [],
  perChangeMissing = [],
  risks = [],
  technicalDesignDecision
}) {
  if (technicalDesignDecision?.requiresTechnicalDesign) {
    return;
  }

  const technicalDesignRelative = toRelative(
    repoRoot,
    getChangeDocPath(changeRoot, meta || {}, "technicalDesign")
  );

  removeArrayItemsInPlace(missing, (item) => item === technicalDesignRelative);
  removeArrayItemsInPlace(perChangeMissing, (item) => item === technicalDesignRelative);
  removeArrayItemsInPlace(
    risks,
    (item) => item?.code === "PLACEHOLDER_TECHNICAL_DESIGN" || item?.file === technicalDesignRelative
  );
}

function normalizeTechnicalComplexity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (["high", "高"].includes(normalized)) {
    return "high";
  }
  if (["medium", "mid", "中"].includes(normalized)) {
    return "medium";
  }
  return "low";
}

function extractTechnicalDesignField(content, label) {
  const match = String(content || "").match(new RegExp(`-\\s*${escapeRegExp(label)}\\s*[：:]\\s*(.*)`));
  if (!match) {
    return "";
  }
  return sanitizeTemplateValue(match[1]);
}

function sanitizeTemplateValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized || ["低 / 中 / 高", "否", "是/否", "是 / 否"].includes(normalized)) {
    return "";
  }
  return normalized;
}

function isAffirmativeValue(value) {
  return ["是", "yes", "true", "y"].includes(String(value || "").trim().toLowerCase());
}

function isRequirementsAndSolutionReady(target) {
  return !hasOpenChangeRisk(target, ["PLACEHOLDER_REQUIREMENTS_AND_SOLUTION"]) && !hasMissingDocRole(target, "requirementsAndSolution");
}

function isTechnicalDesignReady(target) {
  return !hasOpenChangeRisk(target, ["PLACEHOLDER_TECHNICAL_DESIGN"]) && !hasMissingDocRole(target, "technicalDesign");
}

function isPlanAndExecutionReady(target) {
  return !hasOpenChangeRisk(target, ["PLACEHOLDER_PLAN_AND_EXECUTION"]) && !hasMissingDocRole(target, "planAndExecution");
}

function isAcceptanceAndHandoffReady(target) {
  return !hasOpenChangeRisk(target, ["PLACEHOLDER_ACCEPTANCE_AND_HANDOFF"]) && !hasMissingDocRole(target, "acceptanceAndHandoff");
}

function hasOpenChangeRisk(target, codes = []) {
  const codeSet = new Set(codes);
  return (target?.risks || []).some((item) => codeSet.has(item.code));
}

function hasMissingDocRole(target, role) {
  const relative = target?.docRoles?.[role];
  return Boolean(relative) && (target?.missing || []).some((item) => item.endsWith(`/${relative}`) || item === relative);
}

function removeArrayItemsInPlace(items, predicate) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      items.splice(index, 1);
    }
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    action: `先修复 ${scope} ${targetId} 的无效 governance record（JSON / scope / target / 引用）后重新运行 \`specnfc ${scope} check ${targetId}\``,
    details: sampleFiles
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

function buildScopedRuleGate({ scope, runtimeRules, items = [], itemType }) {
  const blocking = [];
  const advisory = [];
  const blockingEnabled = runtimeRules?.blockingScopes?.includes(scope);
  const advisoryEnabled = runtimeRules?.advisoryScopes?.includes(scope);

  for (const item of items) {
    for (const missingFile of item.missing ?? []) {
      const normalized = {
        scope,
        itemType,
        id: item.id,
        stage: item.stage ?? item.status ?? "unknown",
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
        itemType,
        id: item.id,
        stage: item.stage ?? item.status ?? "unknown",
        code: issue.code,
        message: issue.message,
        file: issue.file ?? null,
        action: issue.action ?? item.delivery?.action ?? item.maturity?.action ?? item.action ?? "先修复当前规则问题",
        details: issue.details ?? []
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

function formatRuleBlockingMessage(scope, items = []) {
  const top = items
    .slice(0, 3)
    .map((item) => item.file || item.message || item.id || item.code)
    .filter(Boolean);
  const detail = top.length ? `：${top.join("、")}` : "";
  const label = scope === "integration" ? "INTEGRATION_RULES_BLOCKING" : "CHANGE_RULES_BLOCKING";
  return `${label}：当前${scope}存在规则阻断，需先修复后再推进${detail}`;
}

async function inspectProjectProtocolGate({ repoRoot, repoPaths }) {
  const issues = [];

  if (!(await pathExists(repoPaths.projectIndexPath))) {
    issues.push({
      code: "PROJECT_INDEX_MISSING",
      message: "project-index.json 缺失，当前仓尚未完成项目层协议接管",
      file: ".specnfc/indexes/project-index.json",
      action: "先补齐 project-index.json"
    });
  }

  if (!(await pathExists(repoPaths.projectSummaryPath))) {
    issues.push({
      code: "PROJECT_DOC_MISSING",
      message: "specs/project/summary.md 缺失，当前仓缺少项目层摘要入口",
      file: "specs/project/summary.md",
      action: "先补齐项目汇总文档"
    });
  }

  return issues;
}

function buildProjectProtocolGate({ governanceMode, issues = [] }) {
  const normalized = issues.map((issue) => ({
    scope: "change",
    itemType: "repository",
    id: "project-protocol",
    stage: "project",
    ...issue
  }));

  if (["strict", "locked"].includes(governanceMode)) {
    return {
      blocking: normalized,
      advisory: []
    };
  }

  return {
    blocking: [],
    advisory: normalized
  };
}

async function getExistingChangeIds(changesRoot) {
  if (!(await pathExists(changesRoot))) {
    return [];
  }

  const entries = await listDir(changesRoot);
  const ids = [];

  for (const entry of entries) {
    const targetPath = path.join(changesRoot, entry);
    if (await isDirectory(targetPath)) {
      ids.push(entry);
    }
  }

  return ids.sort();
}

function toRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}

const INTEGRATION_REFERENCE_PATTERNS = [
  /(?:^|\n)\s*-\s*integration-id\s*[：:]\s*`?([a-z0-9][a-z0-9-]*)`?/gim,
  /(?:^|\n)\s*-\s*关联对接\s*[：:]\s*`?([a-z0-9][a-z0-9-]*)`?/gim,
  /(?:^|\n)\s*-\s*对接标识\s*[：:]\s*`?([a-z0-9][a-z0-9-]*)`?/gim
];
