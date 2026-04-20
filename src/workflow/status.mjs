import { inspectRepository } from "../kernel/scaffold.mjs";
import { getRepoPaths, resolvePathWithin } from "../kernel/paths.mjs";
import { listDir, pathExists, readJson, writeJson } from "../utils/fs.mjs";
import { updateExecutionPointers } from "../kernel/execution-pointers.mjs";
import { updateRepositoryIndexes } from "../kernel/indexes.mjs";
import { syncRuntimeLinksForRepo } from "../kernel/writeback.mjs";
import { buildClarifyInterviewProtocol, buildTechnicalDesignInterviewProtocol, inspectChanges } from "./changes.mjs";

const STATUS_PRIORITY = ["draft", "design", "ready", "in-progress", "verifying", "handoff", "archived"];

export async function inspectStatus({ repoRoot }) {
  const repository = await inspectRepositoryWithFallback({ repoRoot });

  if (!repository.initialized) {
    return {
      status: "not_initialized",
      repo: {
      initialized: false,
      profile: null,
      modules: [],
      integrations: emptyIntegrationSummary(),
      activeRules: null,
      repositoryAdvisories: [],
      projectMemory: null,
      projectIndex: null,
      governanceRecords: null,
      governanceRegistries: null,
      runtimeAudit: null,
      controlPlane: null
    },
      summary: {
        activeChangeCount: 0,
        activeIntegrationCount: 0,
        highestPriority: "当前仓尚未初始化",
        repositoryAdvisoryCount: 0,
        projectMemoryAdvisoryCount: 0,
        projectIndexAdvisoryCount: 0,
        governanceRecordCount: 0,
        invalidGovernanceRecordCount: 0,
        readiness: emptyReadinessSummary(),
        relationships: emptyRelationshipSummary()
      },
      changes: [],
      risks: [],
      next: ["运行 `specnfc init --with context,execution,governance`"]
    };
  }

  const changeReport = await inspectChangesWithFallback({ repoRoot });
  const changes = summarizeChanges(changeReport.changes);
  const highestPriorityChange = pickHighestPriority(changes);
  const activeChangeReport = highestPriorityChange?.id
    ? await inspectChangesWithFallback({ repoRoot, rawChangeId: highestPriorityChange.id })
    : null;
  const risks = summarizeRisks({
    repositoryRisks: repository.risks ?? [],
    changes,
    highestPriorityChange
  });
  const status = deriveRepoStatus({
    initialized: repository.initialized,
    risks,
    changes,
    compliance: repository.compliance
  });
  const relationships = summarizeRelationships(changes);
  const readiness = summarizeReadiness({
    repository,
    changes,
    risks,
    relationships
  });
  const nextStepProtocol = buildDynamicNextStepProtocol({
    status,
    highestPriorityChange,
    activeChangeNextStep: activeChangeReport?.nextStep ?? null,
    repository,
    changes,
    risks
  });
  await persistNextStepProtocol({ repoRoot, nextStepProtocol });
  await updateExecutionPointers({
    repoRoot,
    currentPhase: nextStepProtocol.currentPhase
  });
  await syncRuntimeLinksForRepo({ repoRoot });
  await updateRepositoryIndexes({ repoRoot });

  return {
    status,
    repo: {
      initialized: true,
      profile: repository.profile,
      modules: repository.installedModules,
      integrations: repository.integrations ?? emptyIntegrationSummary(),
      activeRules: repository.runtimeRules ?? null,
      repositoryAdvisories: repository.repositoryAdvisories ?? [],
      projectMemory: repository.projectMemory ?? null,
      projectIndex: repository.projectIndex ?? null,
      governanceRecords: repository.governanceRecords ?? null,
      governanceRegistries: repository.governanceRegistries ?? null,
      externalSkillImports: repository.externalSkillImports ?? null,
      runtimeAudit: repository.runtimeAudit ?? null,
      controlPlane: repository.controlPlane ?? null,
      nextStepProtocol,
      compliance: repository.compliance ?? null,
      releaseReadiness: repository.releaseReadiness ?? emptyReadinessSummary(),
      integrationDependencies: repository.integrationDependencies ?? emptyRelationshipSummary()
    },
    summary: {
      activeChangeCount: changes.length,
      activeIntegrationCount: repository.integrations?.total ?? 0,
      repositoryAdvisoryCount: repository.repositoryAdvisories?.length ?? 0,
      projectMemoryAdvisoryCount: repository.projectMemory?.advisoryCount ?? 0,
      projectIndexAdvisoryCount: repository.projectIndex?.advisoryCount ?? 0,
      governanceRecordCount: repository.governanceRecords?.recordCounts?.total ?? 0,
      invalidGovernanceRecordCount: repository.governanceRecords?.invalidRecords?.length ?? 0,
      governanceRegistryAdvisoryCount: repository.governanceRegistries?.advisoryCount ?? 0,
      externalSkillImportCount: repository.externalSkillImports?.totalCount ?? 0,
      externalSkillImportInvalidCount: repository.externalSkillImports?.invalidCount ?? 0,
      runtimeDecisionCount: repository.runtimeAudit?.stageDecisions?.decisionCount ?? 0,
      runtimeEvidenceRefCount: repository.runtimeAudit?.evidenceRefs?.totalRefs ?? 0,
      readiness,
      relationships,
      highestPriorityChange: buildHighestPriorityChange(highestPriorityChange),
      highestPriority: buildHighestPrioritySummary({
        status,
        risks,
        highestPriorityChange
      })
    },
    changes,
    risks,
    readingPath: buildReadingPath({
      projectMemory: repository.projectMemory,
      projectIndex: repository.projectIndex,
      highestPriorityChange,
      integrations: repository.integrations
    }),
    next: buildNextSteps({
      status,
      highestPriorityChange,
      changes,
      repository
    })
  };
}

async function inspectRepositoryWithFallback({ repoRoot }) {
  try {
    return await inspectRepository(repoRoot);
  } catch (error) {
    return inspectRepositoryFromControlPlane({ repoRoot, error });
  }
}

async function inspectRepositoryFromControlPlane({ repoRoot, error }) {
  const repoPaths = getRepoPaths(repoRoot);
  const config = await readJsonIfExists(repoPaths.configPath);

  if (!config) {
    return {
      initialized: false,
      profile: null,
      installedModules: [],
      healthy: [],
      missing: [],
      risks: [],
      changes: { active: 0, archived: 0, delivery: {}, maturity: {} },
      integrations: emptyIntegrationSummary(),
      integrationDependencies: emptyRelationshipSummary(),
      releaseReadiness: emptyReadinessSummary(),
      runtimeRules: null,
      repositoryAdvisories: [],
      projectMemory: null,
      projectIndex: null,
      governanceRecords: null,
      governanceRegistries: null,
      externalSkillImports: null,
      runtimeAudit: null,
      controlPlane: null,
      nextStepProtocol: null,
      compliance: null,
      fallback: {
        used: true,
        reason: error instanceof Error ? error.message : String(error)
      }
    };
  }

  const repoContract = await readJsonIfExists(repoPaths.repoContractPath);
  const governanceModeRecord = await readJsonIfExists(repoPaths.governanceModePath);
  const activeRules = await readJsonIfExists(repoPaths.activeRulesPath);
  const projectIndex = await readJsonIfExists(repoPaths.projectIndexPath);
  const nextStepProtocol = await readJsonIfExists(resolvePathWithin(repoRoot, ".specnfc/execution/next-step.json"));

  return {
    initialized: true,
    profile: config.repository?.profile || "minimal",
    installedModules: Object.entries(config.modules || {})
      .filter(([, value]) => Boolean(value?.enabled))
      .map(([name]) => name)
      .sort((left, right) => left.localeCompare(right)),
    healthy: [],
    missing: [],
    risks: [],
    changes: { active: 0, archived: 0, delivery: {}, maturity: {} },
    integrations: emptyIntegrationSummary(),
    integrationDependencies: emptyRelationshipSummary(),
    releaseReadiness: emptyReadinessSummary(),
    runtimeRules: activeRules,
    repositoryAdvisories: [],
    projectMemory: null,
    projectIndex,
    governanceRecords: null,
    governanceRegistries: null,
    externalSkillImports: null,
    runtimeAudit: null,
    controlPlane: {
      status: repoContract ? "complete" : "partial",
      repoContractPath: ".specnfc/contract/repo.json",
      governanceMode: governanceModeRecord?.governanceMode ?? repoContract?.governanceMode ?? "guided",
      activeSkillPack: repoContract?.activeSkillPack ?? "specnfc-zh-cn-default",
      projectionStatus: "synced",
      projectionHealth: { checkedCount: 0, driftCount: 0, missingCount: 0 },
      skillPackStatus: "synced",
      runtimeSyncStatus: "clean",
      pendingWritebackCount: 0,
      writebackTargets: [],
      writebackItems: [],
      governanceRegistryStatus: "complete",
      governanceRegistryCount: 0,
      governanceRegistryMissingCount: 0,
      nfcRuntimeRoot: ".nfc",
      missingCount: 0,
      checks: {},
      runtimeAuditStatus: "empty",
      runtimeLedgerPath: ".nfc/state/runtime-ledger.json",
      runtimeEventCount: 0
    },
    nextStepProtocol,
    compliance: {
      scope: "repository",
      complianceLevel: "clean",
      blockingIssues: [],
      advisoryIssues: [],
      missingDocs: [],
      projectionStatus: "synced",
      stageStatus: "complete",
      runtimeSyncStatus: "clean",
      writebackTargets: [],
      recommendedActions: ["运行 `specnfc status` 查看主链路"],
      generatedAt: new Date().toISOString()
    },
    fallback: {
      used: true,
      reason: error instanceof Error ? error.message : String(error)
    }
  };
}

async function inspectChangesWithFallback({ repoRoot, rawChangeId = null }) {
  try {
    return await inspectChanges({ repoRoot, rawChangeId });
  } catch (error) {
    return inspectChangesFromMeta({ repoRoot, error, rawChangeId });
  }
}

async function readJsonIfExists(targetPath) {
  if (!(await pathExists(targetPath))) {
    return null;
  }

  try {
    return await readJson(targetPath);
  } catch {
    return null;
  }
}

async function inspectChangesFromMeta({ repoRoot, error, rawChangeId = null }) {
  const repoPaths = getRepoPaths(repoRoot);
  if (!(await pathExists(repoPaths.changesRoot))) {
    return emptyChangeReport();
  }

  const entries = (await listDir(repoPaths.changesRoot)).sort((left, right) => left.localeCompare(right));
  const changes = [];

  for (const entry of entries) {
    const metaPath = resolvePathWithin(repoRoot, "specs", "changes", entry, "meta.json");
    if (!(await pathExists(metaPath))) {
      continue;
    }

    let meta;
    try {
      meta = await readJson(metaPath);
    } catch {
      continue;
    }

    const normalizedId = meta.id || entry;
    if (rawChangeId && normalizedId !== rawChangeId) {
      continue;
    }

    changes.push({
      id: normalizedId,
      title: meta.title || entry,
      type: meta.type || "unknown",
      docRoles: meta.docRoles || null,
      stage: meta.stage || meta.legacyStage || "draft",
      canonicalStage: meta.canonicalStage || mapLegacyStage(meta.stage || meta.legacyStage || "draft"),
      legacyStage: meta.legacyStage || meta.stage || "draft",
      delivery: { summary: "未核验", action: "当前无" },
      maturity: { summary: "未核验", action: "当前无", status: "unknown", gaps: [] },
      integrations: { refs: [], blocked: [] },
      governance: null,
      writeback: { count: 0, targetDocs: [] },
      technicalDesignDecision: null,
      healthy: [],
      missing: [],
      risks: []
    });
  }

  return {
    ...emptyChangeReport(),
    requestedId: rawChangeId,
    changes,
    fallback: {
      used: true,
      reason: error instanceof Error ? error.message : String(error)
    }
  };
}

function emptyChangeReport() {
  return {
    requestedId: null,
    changes: [],
    healthy: [],
    missing: [],
    risks: [],
    runtimeRules: null,
    governanceMode: "guided",
    projectProtocolGate: null,
    blocking: [],
    advisory: [],
    nextStep: null
  };
}

function summarizeChanges(changes) {
  return (changes ?? [])
    .filter((change) => change.stage !== "archived")
    .map((change) => ({
      id: change.id,
      title: change.title,
      docRoles: change.docRoles || null,
      stage: change.stage,
      canonicalStage: change.canonicalStage,
      technicalDesignDecision: change.technicalDesignDecision || null,
      maturityStatus: change.maturity?.status || "unknown",
      maturity: change.maturity?.summary || "未知",
      delivery: change.delivery?.summary || "未启用",
      action: pickPrimaryAction(change),
      integrations: {
        refs: change.integrations?.refs || [],
        blocked: change.integrations?.blocked || []
      },
      gaps: change.maturity?.gaps || [],
      risks: change.risks || [],
      missing: change.missing || []
    }));
}

function pickHighestPriority(changes) {
  return [...changes].sort(compareChanges)[0] || null;
}

function compareChanges(left, right) {
  const leftBlocked = Number(Boolean(left.risks?.length || left.missing?.length));
  const rightBlocked = Number(Boolean(right.risks?.length || right.missing?.length));
  if (leftBlocked !== rightBlocked) {
    return rightBlocked - leftBlocked;
  }

  const leftDeliveryBlocked = Number(isDeliveryBlocking(left));
  const rightDeliveryBlocked = Number(isDeliveryBlocking(right));
  if (leftDeliveryBlocked !== rightDeliveryBlocked) {
    return rightDeliveryBlocked - leftDeliveryBlocked;
  }

  return STATUS_PRIORITY.indexOf(right.stage) - STATUS_PRIORITY.indexOf(left.stage);
}

function pickPrimaryAction(change) {
  const deliveryAction = change.delivery?.action;
  const maturityAction = change.maturity?.action;
  const maturityStatus = change.maturity?.status || "unknown";
  const preferMaturityFirst = ["broken", "draft", "incomplete"].includes(maturityStatus);

  if (preferMaturityFirst) {
    if (maturityAction && maturityAction !== "当前无") {
      return maturityAction;
    }

    if (deliveryAction && deliveryAction !== "当前无") {
      return deliveryAction;
    }

    return "当前无";
  }

  if (deliveryAction && deliveryAction !== "当前无") {
    return deliveryAction;
  }

  if (maturityAction && maturityAction !== "当前无") {
    return maturityAction;
  }

  return "当前无";
}

function isDeliveryBlocking(change) {
  return String(change.action || "").includes("交付") || String(change.action || "").includes("handoff");
}

function summarizeRisks({ repositoryRisks, changes, highestPriorityChange }) {
  const riskMap = new Map();

  for (const item of repositoryRisks ?? []) {
    riskMap.set(`${item.code}:${item.message}`, item);
  }

  if (highestPriorityChange) {
    for (const item of highestPriorityChange.risks ?? []) {
      riskMap.set(`${item.code}:${item.message}`, item);
    }
  }

  for (const change of changes) {
    for (const item of change.risks ?? []) {
      riskMap.set(`${item.code}:${item.message}`, item);
    }
  }

  return Array.from(riskMap.values());
}

function deriveRepoStatus({ initialized, risks, changes, compliance }) {
  if (!initialized) {
    return "not_initialized";
  }

  if ((compliance?.blockingIssues?.length ?? 0) > 0) {
    return "attention_needed";
  }

  if (risks.length || changes.some((change) => change.risks.length || change.missing.length)) {
    return "attention_needed";
  }

  if (changes.some((change) => change.stage === "verifying")) {
    return "ready_for_handoff";
  }

  if (changes.length) {
    return "in_progress";
  }

  return "healthy_idle";
}

function buildHighestPrioritySummary({ status, risks, highestPriorityChange }) {
  if (status === "not_initialized") {
    return "当前仓尚未初始化";
  }

  if (highestPriorityChange?.action && highestPriorityChange.action !== "当前无") {
    return `${highestPriorityChange.id}：${highestPriorityChange.action}`;
  }

  if (highestPriorityChange?.risks?.length) {
    return `${highestPriorityChange.id} ${highestPriorityChange.risks[0].message}`;
  }

  if (highestPriorityChange) {
    return `${highestPriorityChange.id}：继续推进`;
  }

  if (risks[0]) {
    return risks[0].message;
  }

  return "当前仓健康且空闲";
}

function buildReadingPath({ projectMemory, projectIndex, highestPriorityChange, integrations }) {
  const items = [".specnfc/README.md", ".specnfc/runtime/active-rules.json"];

  for (const path of projectIndex?.readingPath ?? []) {
    if (!items.includes(path)) {
      items.push(path);
    }
  }

  for (const item of projectMemory?.index?.repository ?? []) {
    for (const path of item.paths ?? []) {
      if (path.endsWith(".md") && !items.includes(path)) {
        items.push(path);
      }
    }
  }

  if (highestPriorityChange?.id) {
    items.push(`specs/changes/${highestPriorityChange.id}/meta.json`);
    const changeDocs = highestPriorityChange.docRoles
      ? [
          `specs/changes/${highestPriorityChange.id}/${highestPriorityChange.docRoles.requirementsAndSolution}`,
          `specs/changes/${highestPriorityChange.id}/${highestPriorityChange.docRoles.technicalDesign}`,
          `specs/changes/${highestPriorityChange.id}/${highestPriorityChange.docRoles.planAndExecution}`,
          `specs/changes/${highestPriorityChange.id}/${highestPriorityChange.docRoles.acceptanceAndHandoff}`
        ]
      : [
          `specs/changes/${highestPriorityChange.id}/spec.md`,
          `specs/changes/${highestPriorityChange.id}/decisions.md`,
          `specs/changes/${highestPriorityChange.id}/status.md`
        ];
    for (const docPath of changeDocs.filter(Boolean)) {
      items.push(docPath);
    }
  } else {
    items.push("specs/README.md");
  }

  if ((integrations?.blockedItems || []).length) {
    const blocked = integrations.blockedItems[0];
    items.push(`specs/integrations/${blocked.id}/contract.md`);
    items.push(`specs/integrations/${blocked.id}/status.md`);
  }

  return dedupe(items);
}

function buildNextSteps({ status, highestPriorityChange, changes, repository }) {
  const hasProjectSummaryGap = repository?.projectIndex?.advisories?.some((item) => item.code?.startsWith("PROJECT_SUMMARY_"));
  const hasGovernanceRegistryGap = (repository?.governanceRegistries?.advisoryCount ?? 0) > 0;
  const hasChangeStructureDrift = repository?.repositoryAdvisories?.some((item) => item.code === "CHANGE_STRUCTURE_DRIFT");
  const protocol = buildPrimaryNextGuidance({
    status,
    highestPriorityChange,
    hasProjectSummaryGap,
    hasGovernanceRegistryGap
  });

  switch (status) {
    case "not_initialized":
      return ["运行 `specnfc init --with context,execution,governance`"];
    case "attention_needed":
      return dedupe([
        protocol.primaryAction ? `当前先执行 \`${protocol.primaryAction}\`` : null,
        protocol.afterPrimaryAction ? `完成后下一步：${protocol.afterPrimaryAction}` : null,
        protocol.doNotDoYet.length ? `当前不该做：${protocol.doNotDoYet.join("；")}` : null,
        ...(repository?.compliance?.recommendedActions || []).slice(0, 1)
      ]);
    case "ready_for_handoff":
      return dedupe([
        highestPriorityChange ? `运行 \`specnfc change handoff ${highestPriorityChange.id}\`` : null,
        "生成交接单后重新运行 `specnfc status`"
      ]);
    case "in_progress":
      return dedupe([
        protocol.primaryAction ? `当前先执行 \`${protocol.primaryAction}\`` : null,
        protocol.afterPrimaryAction ? `完成后下一步：${protocol.afterPrimaryAction}` : null,
        protocol.doNotDoYet.length ? `当前不该做：${protocol.doNotDoYet.join("；")}` : null,
        hasChangeStructureDrift ? "另：运行 `specnfc upgrade` 校正仓内 change 文档结构模板" : null
      ]);
    case "healthy_idle":
      return dedupe([
        protocol.primaryAction ? `当前先执行 \`${protocol.primaryAction}\`` : null,
        protocol.afterPrimaryAction ? `完成后下一步：${protocol.afterPrimaryAction}` : null,
        protocol.doNotDoYet.length ? `当前不该做：${protocol.doNotDoYet.join("；")}` : null,
        hasChangeStructureDrift ? "另：运行 `specnfc upgrade` 校正仓内 change 文档结构模板" : null
      ]);
    default:
      return changes.length ? ["运行 `specnfc change list` 查看当前 change"] : [];
  }
}

function buildDynamicNextStepProtocol({ status, highestPriorityChange, activeChangeNextStep, repository, changes, risks }) {
  const completed = [];
  const missing = [];
  const blocking = [];
  const recommendedNext = [];
  const hasProjectSummaryGap = repository.projectIndex?.advisories?.some((item) => item.code?.startsWith("PROJECT_SUMMARY_"));
  const hasGovernanceRegistryGap = (repository.governanceRegistries?.advisoryCount ?? 0) > 0;
  const hasChangeStructureDrift = repository.repositoryAdvisories?.some((item) => item.code === "CHANGE_STRUCTURE_DRIFT");
  const primaryGuidance = buildPrimaryNextGuidance({
    status,
    highestPriorityChange,
    hasProjectSummaryGap,
    hasGovernanceRegistryGap
  });
  const primaryDoc = resolveStatusPrimaryDoc({
    highestPriorityChange,
    activeChangeNextStep,
    fallback: primaryGuidance.primaryDoc
  });
  const activeGuidance = highestPriorityChange ? mergeStatusChangeGuidance({ primaryGuidance, activeChangeNextStep }) : primaryGuidance;

  if (repository.controlPlane?.status === "complete") {
    completed.push("control plane 已初始化");
  }
  if ((repository.projectIndex?.advisoryCount ?? 0) === 0 && repository.projectIndex?.status === "complete") {
    completed.push("project index 已就绪");
  }
  if (repository.controlPlane?.runtimeSyncStatus === "pending") {
    missing.push("存在待写回运行时结果");
  } else if (repository.controlPlane?.runtimeSyncStatus === "invalid") {
    missing.push("运行时写回队列已损坏");
  }
  if (hasProjectSummaryGap) {
    missing.push("project summary 仍是初始化占位或缺少必填章节");
  } else if ((repository.projectIndex?.advisoryCount ?? 0) > 0) {
    missing.push("project-level index 缺失或漂移");
  }
  if (hasGovernanceRegistryGap) {
    missing.push("团队 / 项目治理注册中心缺失或损坏");
  }
  if (hasChangeStructureDrift) {
    missing.push("仓内 defaults.changeStructure 仍不是 3.1 四主文档结构");
  }
  if (highestPriorityChange?.id) {
    completed.push(`已识别最高优先 change：${highestPriorityChange.id}`);
  } else {
    missing.push("当前无 active change");
  }

  for (const item of repository.compliance?.blockingIssues || []) {
    blocking.push(item);
  }

  switch (status) {
    case "healthy_idle":
      recommendedNext.push({ type: "cli", value: primaryGuidance.primaryAction });
      break;
    case "attention_needed":
      recommendedNext.push({ type: "cli", value: primaryGuidance.primaryAction });
      break;
    case "ready_for_handoff":
      if (highestPriorityChange?.id) {
        recommendedNext.push({ type: "cli", value: `specnfc change handoff ${highestPriorityChange.id}` });
        recommendedNext.push({ type: "skill", value: "交付归档" });
      }
      break;
    case "in_progress":
      recommendedNext.push({ type: "cli", value: primaryGuidance.primaryAction });
      break;
    default:
      recommendedNext.push({ type: "cli", value: "specnfc status" });
      break;
  }

  if (hasChangeStructureDrift) {
    recommendedNext.push({ type: "cli", value: "specnfc upgrade" });
  }

  const interviewProtocol = buildStatusInterviewProtocol({ highestPriorityChange });
  const confirmedFacts = pickProtocolArray(activeGuidance.confirmedFacts, interviewProtocol.confirmedFacts);
  const readinessGates = pickProtocolArray(activeGuidance.readinessGates, interviewProtocol.readinessGates);
  const writebackSections = pickProtocolArray(activeGuidance.writebackSections, interviewProtocol.writebackSections);

  return {
    currentPhase: activeChangeNextStep?.currentPhase ?? deriveCurrentPhase({ status, highestPriorityChange }),
    governanceMode: repository.controlPlane?.governanceMode ?? "guided",
    step: activeGuidance.step,
    stepLabel: activeGuidance.stepLabel,
    completed,
    missing,
    blocking,
    recommendedNext,
    primaryAction: primaryGuidance.primaryAction,
    primaryGoal: activeGuidance.primaryGoal,
    primaryDoc,
    requiredSections: activeGuidance.requiredSections,
    doNotDoYet: activeGuidance.doNotDoYet,
    exitCriteria: activeGuidance.exitCriteria,
    afterPrimaryAction: activeGuidance.afterPrimaryAction,
    writebackRequired: repository.controlPlane?.runtimeSyncStatus === "pending",
    projectionDrift: repository.controlPlane?.projectionStatus === "drifted",
    skillPackDrift: repository.controlPlane?.skillPackStatus !== "synced",
    interviewRound: activeGuidance.interviewRound ?? interviewProtocol.interviewRound ?? null,
    interviewTarget: activeGuidance.interviewTarget ?? interviewProtocol.interviewTarget ?? null,
    ambiguityPercent: activeGuidance.ambiguityPercent ?? interviewProtocol.ambiguityPercent ?? null,
    confirmedFacts,
    readinessGates,
    focusQuestion: activeGuidance.focusQuestion ?? interviewProtocol.focusQuestion ?? null,
    writebackSections,
    stepAware: true,
    updatedAt: new Date().toISOString()
  };
}

function mergeStatusChangeGuidance({ primaryGuidance, activeChangeNextStep }) {
  if (!activeChangeNextStep) {
    return primaryGuidance;
  }

  return {
    ...primaryGuidance,
    primaryGoal: activeChangeNextStep.primaryGoal ?? primaryGuidance.primaryGoal,
    requiredSections: activeChangeNextStep.requiredSections ?? primaryGuidance.requiredSections,
    doNotDoYet: dedupe([...(primaryGuidance.doNotDoYet || []), ...(activeChangeNextStep.doNotDoYet || [])]),
    exitCriteria: activeChangeNextStep.exitCriteria ?? primaryGuidance.exitCriteria,
    afterPrimaryAction: activeChangeNextStep.afterPrimaryAction ?? primaryGuidance.afterPrimaryAction,
    interviewRound: activeChangeNextStep.interviewRound ?? null,
    interviewTarget: activeChangeNextStep.interviewTarget ?? null,
    ambiguityPercent: activeChangeNextStep.ambiguityPercent ?? null,
    confirmedFacts: activeChangeNextStep.confirmedFacts,
    readinessGates: activeChangeNextStep.readinessGates,
    focusQuestion: activeChangeNextStep.focusQuestion ?? null,
    writebackSections: activeChangeNextStep.writebackSections
  };
}

function pickProtocolArray(primary, fallback) {
  if (Array.isArray(primary) && primary.length > 0) {
    return primary;
  }
  if (Array.isArray(fallback) && fallback.length > 0) {
    return fallback;
  }
  return Array.isArray(primary) ? primary : Array.isArray(fallback) ? fallback : [];
}

function resolveStatusPrimaryDoc({ highestPriorityChange, activeChangeNextStep, fallback }) {
  if (!highestPriorityChange?.id) {
    return fallback;
  }

  if (!activeChangeNextStep?.primaryDoc) {
    return fallback;
  }

  if (activeChangeNextStep.primaryDoc.startsWith("specs/")) {
    return activeChangeNextStep.primaryDoc;
  }

  return `specs/changes/${highestPriorityChange.id}/${activeChangeNextStep.primaryDoc}`;
}

function buildStatusInterviewProtocol({ highestPriorityChange }) {
  if (!highestPriorityChange) {
    return {};
  }

  if (highestPriorityChange.canonicalStage === "clarify") {
    return buildClarifyInterviewProtocol(highestPriorityChange);
  }

  if (highestPriorityChange.canonicalStage === "design") {
    return buildTechnicalDesignInterviewProtocol(
      highestPriorityChange,
      highestPriorityChange.technicalDesignDecision || null
    );
  }

  return {};
}

function deriveCurrentPhase({ status, highestPriorityChange }) {
  if (highestPriorityChange?.stage) {
    return mapLegacyStage(highestPriorityChange.stage);
  }
  if (status === "healthy_idle") {
    return "clarify";
  }
  return "clarify";
}

function mapLegacyStage(stage) {
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

function buildPrimaryNextGuidance({ status, highestPriorityChange, hasProjectSummaryGap, hasGovernanceRegistryGap }) {
  if (!highestPriorityChange?.id) {
    return {
      step: "create_change",
      stepLabel: "先创建第一项 change",
      primaryAction: "specnfc change create <change-id>",
      primaryGoal: "先创建一个 change，把接下来的工作纳入标准主链路",
      primaryDoc: "specs/changes/<change-id>/01-需求与方案.md",
      requiredSections: ["问题定义", "目标", "非目标", "范围", "当前选择", "风险与验收口径"],
      doNotDoYet: dedupe([
        "不要先运行 doctor / explain / add 作为默认起手动作",
        "不要在还没有 change 的情况下直接开始写代码或补多份文档",
        hasProjectSummaryGap ? "不要先被项目汇总占位问题打断主链路起步" : null,
        hasGovernanceRegistryGap ? "不要先把治理注册中心修补当作主起手动作" : null
      ]),
      exitCriteria: ["change 已创建", "已进入正式工作对象"],
      afterPrimaryAction: "创建完成后，立即执行 `specnfc change check <change-id>`"
    };
  }

  const primaryDoc = getPrimaryDocForChange(highestPriorityChange);
  const phaseActionLabel = highestPriorityChange.action && highestPriorityChange.action !== "当前无" ? highestPriorityChange.action : "按当前阶段补齐必需文档与门禁";
  const phaseLabel = highestPriorityChange.canonicalStage || deriveCurrentPhase({ status, highestPriorityChange });

  return {
    step: "check_active_change",
    stepLabel: "先校验当前 active change",
    primaryAction: `specnfc change check ${highestPriorityChange.id}`,
    primaryGoal: `先确认 ${highestPriorityChange.id} 当前处于「${phaseLabel}」阶段时必须维护的文档与门禁`,
    primaryDoc,
    requiredSections: buildPrimaryDocRequiredSections(highestPriorityChange),
    doNotDoYet: dedupe([
      primaryDoc ? `不要跳过 \`${primaryDoc}\` 直接去改后续文档或代码` : "不要跳过当前阶段直接推进后续工作",
      "不要跳过 check 输出直接自行切阶段",
      hasProjectSummaryGap ? "不要先被 project summary 占位问题打断当前 change 主动作" : null
    ]),
    exitCriteria: [`完成 \`${primaryDoc || "当前主文档"}\` 的当前阶段必填项`, "重新运行 check 后再决定是否进入下一阶段"],
    afterPrimaryAction: `${highestPriorityChange.id} 完成 check 后，只按输出继续：${phaseActionLabel}`
  };
}

function buildPrimaryDocRequiredSections(change) {
  switch (change?.canonicalStage) {
    case "clarify":
      return ["问题定义", "目标", "非目标", "范围", "当前选择", "风险与验收口径"];
    case "design":
      return ["触发说明", "技术背景与约束", "候选方案对比", "选型结论"];
    case "plan":
    case "execute":
      return ["实现计划", "任务清单", "执行状态", "下一步"];
    case "verify":
    case "accept":
    case "archive":
      return ["验收范围", "验证结果", "剩余风险与结论", "交付与发布交接"];
    default:
      return [];
  }
}

function getPrimaryDocForChange(change) {
  if (!change?.docRoles) {
    return null;
  }

  switch (change.canonicalStage) {
    case "clarify":
      return `specs/changes/${change.id}/${change.docRoles.requirementsAndSolution}`;
    case "design":
      return `specs/changes/${change.id}/${change.docRoles.technicalDesign}`;
    case "plan":
    case "execute":
      return `specs/changes/${change.id}/${change.docRoles.planAndExecution}`;
    case "verify":
    case "accept":
    case "archive":
      return `specs/changes/${change.id}/${change.docRoles.acceptanceAndHandoff}`;
    default:
      return `specs/changes/${change.id}/${change.docRoles.requirementsAndSolution}`;
  }
}

async function persistNextStepProtocol({ repoRoot, nextStepProtocol }) {
  const targetPath = resolvePathWithin(repoRoot, ".specnfc/execution/next-step.json");
  await writeJson(targetPath, nextStepProtocol);
}

function buildHighestPriorityChange(change) {
  if (!change) {
    return null;
  }

  return {
    id: change.id,
    title: change.title,
    stage: change.stage,
    action: change.action,
    integrations: change.integrations || { refs: [], blocked: [] },
    gaps: change.gaps || [],
    riskCount: change.risks?.length || 0,
    missingCount: change.missing?.length || 0
  };
}

function summarizeRelationships(changes) {
  const integrationRefs = new Set();
  const blockedIntegrationRefs = new Set();
  let changesWithIntegrationsCount = 0;
  let changesBlockedByIntegrationCount = 0;

  for (const change of changes) {
    if (change.integrations?.refs?.length) {
      changesWithIntegrationsCount += 1;
      for (const ref of change.integrations.refs) {
        integrationRefs.add(ref);
      }
    }

    if (change.integrations?.blocked?.length) {
      changesBlockedByIntegrationCount += 1;
      for (const blocked of change.integrations.blocked) {
        if (blocked?.id) {
          blockedIntegrationRefs.add(blocked.id);
        }
      }
    }
  }

  return {
    totalIntegrationRefs: integrationRefs.size,
    changesWithIntegrationsCount,
    changesBlockedByIntegrationCount,
    blockedIntegrationRefs: Array.from(blockedIntegrationRefs).sort(),
    blockedIntegrationRefCount: blockedIntegrationRefs.size
  };
}

function summarizeReadiness({ repository, changes, risks, relationships }) {
  const blockedChangeCount = changes.filter((change) => (change.risks?.length || 0) > 0 || (change.missing?.length || 0) > 0).length;
  const handoffReadyChangeCount = changes.filter((change) => ["verifying", "handoff"].includes(change.stage)).length;
  const releaseBlockerCount =
    blockedChangeCount +
    (repository.risks?.length || 0) +
    (relationships.blockedIntegrationRefCount || 0);

  return {
    handoffReadyChangeCount,
    blockedChangeCount,
    blockedIntegrationRefCount: relationships.blockedIntegrationRefCount || 0,
    changesBlockedByIntegrationCount: relationships.changesBlockedByIntegrationCount || 0,
    readyIntegrationCount: repository.integrations?.ready ?? 0,
    releaseBlockerCount,
    repositoryRiskCount: repository.risks?.length || risks.length,
    repositoryAdvisoryCount: repository.repositoryAdvisories?.length || 0
  };
}

function dedupe(items) {
  return Array.from(new Set(items.filter(Boolean)));
}

function emptyIntegrationSummary() {
  return {
    total: 0,
    draft: 0,
    aligned: 0,
    implementing: 0,
    integrating: 0,
    blocked: 0,
    done: 0,
    ready: 0,
    unknown: 0,
    blockedItems: [],
    blockedAffectedChanges: []
  };
}

function emptyReadinessSummary() {
  return {
    handoffReadyChangeCount: 0,
    blockedChangeCount: 0,
    blockedIntegrationRefCount: 0,
    changesBlockedByIntegrationCount: 0,
    readyIntegrationCount: 0,
    releaseBlockerCount: 0,
    repositoryRiskCount: 0,
    repositoryAdvisoryCount: 0
  };
}

function emptyRelationshipSummary() {
  return {
    totalIntegrationRefs: 0,
    changesWithIntegrationsCount: 0,
    changesBlockedByIntegrationCount: 0,
    blockedIntegrationRefs: [],
    blockedIntegrationRefCount: 0
  };
}
