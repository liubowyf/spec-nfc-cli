import path from "node:path";
import { getRepoPaths } from "./paths.mjs";
import { inspectWritebackQueue } from "./writeback.mjs";
import { ensureDir, isDirectory, listDir, pathExists, readJson, readText, writeJson, writeText } from "../utils/fs.mjs";

const CHANGE_EVIDENCE_DIRS = [
  path.join("evidence", "reviews"),
  path.join("evidence", "approvals"),
  path.join("evidence", "verifications")
];

const INTEGRATION_EVIDENCE_DIRS = CHANGE_EVIDENCE_DIRS;

export async function inspectRuntimeAudit({
  repoRoot,
  repoPaths = getRepoPaths(repoRoot),
  governanceRecords = null,
  writebackQueue = null
}) {
  const [currentMode, currentStage, runtimeLocks, sessionHints, writebackHistory] = await Promise.all([
    readOptionalJson(repoPaths.currentModePath),
    readOptionalJson(repoPaths.currentStagePath),
    readOptionalJson(repoPaths.runtimeLocksPath),
    readOptionalJson(repoPaths.sessionHintsPath),
    readOptionalJson(repoPaths.writebackHistoryPath)
  ]);

  const queue = writebackQueue ?? (await inspectWritebackQueue({ repoRoot }));
  const evidenceRefs = await collectEvidenceRefs({ repoRoot, repoPaths });
  const stageDecisions = await collectStageDecisions({ repoRoot, repoPaths });
  const runtimeLinks = await collectRuntimeLinks({ repoRoot, repoPaths });
  const eventStreams = await collectEventStreams({ repoPaths });
  const historyItems = Array.isArray(writebackHistory?.items) ? writebackHistory.items : [];
  const locks = Array.isArray(runtimeLocks?.locks) ? runtimeLocks.locks : [];
  const activeLocks = locks.filter(isActiveLock);
  const recordCounts = governanceRecords?.recordCounts ?? emptyGovernanceRecordCounts();
  const governanceTotal = recordCounts.total ?? Object.values(recordCounts).reduce((sum, value) => sum + Number(value || 0), 0);
  const invalidCount = governanceRecords?.invalidCount ?? 0;
  const status = deriveRuntimeAuditStatus({
    invalidCount,
    pendingWritebackCount: queue.count,
    governanceTotal,
    evidenceRefCount: evidenceRefs.totalRefs,
    decisionCount: stageDecisions.decisionCount,
    trackedTargetCount: runtimeLinks.trackedTargetCount,
    historyCount: historyItems.length
  });
  const updatedAt = new Date().toISOString();

  return {
    status,
    runtimeRoot: ".nfc",
    files: {
      ledgerPath: ".nfc/state/runtime-ledger.json",
      runtimeEventsLogPath: ".nfc/logs/runtime-events.ndjson",
      governanceEventsLogPath: ".nfc/logs/governance-events.ndjson",
      writebackHistoryPath: ".nfc/sync/writeback-history.json"
    },
    sessionTrace: {
      mode: currentMode?.mode ?? null,
      currentPhase: currentStage?.currentPhase ?? currentStage?.phase ?? null,
      activeChangeId: currentStage?.activeChangeId ?? null,
      activeIntegrationId: currentStage?.activeIntegrationId ?? null,
      hintCount: Array.isArray(sessionHints?.hints) ? sessionHints.hints.length : 0,
      activeLockCount: activeLocks.length,
      updatedAt: currentStage?.updatedAt ?? currentMode?.updatedAt ?? updatedAt
    },
    governance: {
      status: governanceRecords?.status ?? "unknown",
      recordCounts,
      invalidCount
    },
    writeback: {
      status: queue.status,
      pendingCount: queue.count,
      historyCount: historyItems.length,
      targetDocs: queue.targetDocs,
      lastSyncedAt: historyItems.length ? historyItems[historyItems.length - 1]?.lastSyncedAt ?? null : null
    },
    stageDecisions,
    evidenceRefs,
    runtimeLinks,
    eventStreams,
    updatedAt
  };
}

export async function syncRuntimeAuditArtifacts({
  repoRoot,
  repoPaths = getRepoPaths(repoRoot),
  runtimeAudit
}) {
  await ensureDir(path.dirname(repoPaths.runtimeEventsLogPath));
  const existing = (await pathExists(repoPaths.runtimeEventsLogPath)) ? await readText(repoPaths.runtimeEventsLogPath) : "";
  const eventLine = JSON.stringify({
    event: "runtime-audit-refreshed",
    status: runtimeAudit.status,
    currentPhase: runtimeAudit.sessionTrace?.currentPhase ?? null,
    pendingWritebackCount: runtimeAudit.writeback?.pendingCount ?? 0,
    decisionCount: runtimeAudit.stageDecisions?.decisionCount ?? 0,
    evidenceRefCount: runtimeAudit.evidenceRefs?.totalRefs ?? 0,
    trackedTargetCount: runtimeAudit.runtimeLinks?.trackedTargetCount ?? 0,
    updatedAt: runtimeAudit.updatedAt
  });
  await writeText(repoPaths.runtimeEventsLogPath, `${existing}${eventLine}\n`);
  const nextRuntimeAudit = {
    ...runtimeAudit,
    eventStreams: {
      ...(runtimeAudit.eventStreams || {}),
      runtimeEventCount: (runtimeAudit.eventStreams?.runtimeEventCount ?? 0) + 1
    }
  };
  await writeJson(repoPaths.runtimeLedgerPath, nextRuntimeAudit);
  return nextRuntimeAudit;
}

async function collectEvidenceRefs({ repoRoot, repoPaths }) {
  const refs = [];
  const scopedRefs = [];

  for (const item of await collectScopedEvidenceRefs({
    repoRoot,
    root: repoPaths.changesRoot,
    scope: "change",
    evidenceDirs: CHANGE_EVIDENCE_DIRS
  })) {
    refs.push(...item.refs);
    scopedRefs.push(item);
  }

  for (const item of await collectScopedEvidenceRefs({
    repoRoot,
    root: repoPaths.integrationsRoot,
    scope: "integration",
    evidenceDirs: INTEGRATION_EVIDENCE_DIRS
  })) {
    refs.push(...item.refs);
    scopedRefs.push(item);
  }

  const uniqueRefs = Array.from(new Set(refs)).sort();
  const sampleRefs = scopedRefs
    .filter((item) => item.refs.length)
    .sort((left, right) => `${left.scope}:${left.targetId}`.localeCompare(`${right.scope}:${right.targetId}`))
    .slice(0, 10)
    .map((item) => ({
      scope: item.scope,
      targetId: item.targetId,
      refs: item.refs.slice(0, 5)
    }));

  return {
    totalRefs: refs.length,
    uniqueRefCount: uniqueRefs.length,
    sampleRefs,
    latestRefs: uniqueRefs.slice(0, 10)
  };
}

async function collectStageDecisions({ repoRoot, repoPaths }) {
  const decisions = [];

  decisions.push(
    ...(await collectScopedDecisionRecords({
      repoRoot,
      root: repoPaths.changesRoot,
      scope: "change",
      decisionDir: path.join("evidence", "approvals")
    }))
  );
  decisions.push(
    ...(await collectScopedDecisionRecords({
      repoRoot,
      root: repoPaths.integrationsRoot,
      scope: "integration",
      decisionDir: path.join("evidence", "approvals")
    }))
  );
  decisions.push(...(await collectRepositoryDecisionRecords({ repoRoot, root: repoPaths.releaseDecisionsRoot })));

  decisions.sort(compareDecisionRecords);

  return {
    decisionCount: decisions.length,
    approvedCount: decisions.filter((item) => item.decision === "approved").length,
    latest: decisions.slice(0, 10)
  };
}

async function collectRuntimeLinks({ repoRoot, repoPaths }) {
  const changeItems = await collectScopedRuntimeLinks({ repoRoot, root: repoPaths.changesRoot, scope: "change" });
  const integrationItems = await collectScopedRuntimeLinks({ repoRoot, root: repoPaths.integrationsRoot, scope: "integration" });
  const items = [...changeItems, ...integrationItems];
  const pendingDocs = Array.from(new Set(items.flatMap((item) => item.targetDocs || []))).sort();

  return {
    trackedTargetCount: items.length,
    changeTargetCount: changeItems.length,
    integrationTargetCount: integrationItems.length,
    pendingTargetCount: items.filter((item) => (item.pendingCount ?? 0) > 0).length,
    pendingDocCount: pendingDocs.length,
    pendingDocs: pendingDocs.slice(0, 10)
  };
}

async function collectEventStreams({ repoPaths }) {
  return {
    governanceEventCount: await countNdjsonLines(repoPaths.governanceEventsLogPath),
    runtimeEventCount: await countNdjsonLines(repoPaths.runtimeEventsLogPath)
  };
}

async function collectScopedEvidenceRefs({ repoRoot, root, scope, evidenceDirs }) {
  if (!(await pathExists(root)) || !(await isDirectory(root))) {
    return [];
  }

  const entries = await listDir(root);
  const items = [];

  for (const entry of entries) {
    const targetRoot = path.join(root, entry);
    if (!(await isDirectory(targetRoot))) {
      continue;
    }

    const refs = [];
    for (const evidenceDir of evidenceDirs) {
      const evidenceRoot = path.join(targetRoot, evidenceDir);
      if (!(await pathExists(evidenceRoot)) || !(await isDirectory(evidenceRoot))) {
        continue;
      }

      const files = (await listDir(evidenceRoot)).filter((item) => item.endsWith(".json")).sort();
      for (const fileName of files) {
        const payload = await readOptionalJson(path.join(evidenceRoot, fileName));
        if (!payload) {
          continue;
        }

        const evidenceRefs = Array.isArray(payload.evidenceRefs) ? payload.evidenceRefs.map((item) => String(item)) : [];
        refs.push(...evidenceRefs);
      }
    }

    items.push({
      scope,
      targetId: entry,
      refs: Array.from(new Set(refs)).sort()
    });
  }

  return items;
}

async function collectScopedDecisionRecords({ repoRoot, root, scope, decisionDir }) {
  if (!(await pathExists(root)) || !(await isDirectory(root))) {
    return [];
  }

  const entries = await listDir(root);
  const decisions = [];

  for (const entry of entries) {
    const targetRoot = path.join(root, entry);
    if (!(await isDirectory(targetRoot))) {
      continue;
    }

    const approvalsRoot = path.join(targetRoot, decisionDir);
    if (!(await pathExists(approvalsRoot)) || !(await isDirectory(approvalsRoot))) {
      continue;
    }

    const files = (await listDir(approvalsRoot)).filter((item) => item.endsWith(".json")).sort();
    for (const fileName of files) {
      const filePath = path.join(approvalsRoot, fileName);
      const payload = await readOptionalJson(filePath);
      if (!payload) {
        continue;
      }

      decisions.push({
        scope,
        targetId: String(payload.targetId || entry),
        type: "approval",
        decision: String(payload.decision || payload.verdict || payload.result || "unknown"),
        stage: payload.stage ? String(payload.stage) : null,
        file: toRelative(repoRoot, filePath),
        createdAt: payload.createdAt || null
      });
    }
  }

  return decisions;
}

async function collectRepositoryDecisionRecords({ repoRoot, root }) {
  if (!(await pathExists(root)) || !(await isDirectory(root))) {
    return [];
  }

  const files = (await listDir(root)).filter((item) => item.endsWith(".json")).sort();
  const items = [];
  for (const fileName of files) {
    const filePath = path.join(root, fileName);
    const payload = await readOptionalJson(filePath);
    if (!payload) {
      continue;
    }

    items.push({
      scope: "repository",
      targetId: String(payload.releaseTag || fileName.replace(/\.json$/, "")),
      type: "releaseDecision",
      decision: String(payload.decision || payload.status || "unknown"),
      stage: "accept",
      file: toRelative(repoRoot, filePath),
      createdAt: payload.createdAt || null
    });
  }
  return items;
}

async function collectScopedRuntimeLinks({ repoRoot, root, scope }) {
  if (!(await pathExists(root)) || !(await isDirectory(root))) {
    return [];
  }

  const entries = await listDir(root);
  const items = [];

  for (const entry of entries) {
    const targetRoot = path.join(root, entry);
    if (!(await isDirectory(targetRoot))) {
      continue;
    }

    const runtimeLinksPath = path.join(targetRoot, "runtime-links.json");
    if (!(await pathExists(runtimeLinksPath))) {
      continue;
    }

    const payload = await readOptionalJson(runtimeLinksPath);
    if (!payload) {
      continue;
    }

    items.push({
      scope,
      targetId: String(payload.targetId || entry),
      pendingCount: Number(payload.pendingCount || 0),
      targetDocs: Array.isArray(payload.targetDocs) ? payload.targetDocs.map((item) => String(item)) : [],
      file: toRelative(repoRoot, runtimeLinksPath)
    });
  }

  return items;
}

async function countNdjsonLines(targetPath) {
  if (!(await pathExists(targetPath))) {
    return 0;
  }

  const content = await readText(targetPath);
  return content
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean).length;
}

function deriveRuntimeAuditStatus({
  invalidCount,
  pendingWritebackCount,
  governanceTotal,
  evidenceRefCount,
  decisionCount,
  trackedTargetCount,
  historyCount
}) {
  if (invalidCount > 0) {
    return "attention";
  }
  if (pendingWritebackCount > 0) {
    return "pending";
  }
  if (governanceTotal + evidenceRefCount + decisionCount + trackedTargetCount + historyCount > 0) {
    return "tracked";
  }
  return "empty";
}

function compareDecisionRecords(left, right) {
  const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;
  const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;
  if (leftTime !== rightTime) {
    return rightTime - leftTime;
  }
  return `${left.scope}:${left.targetId}:${left.file}`.localeCompare(`${right.scope}:${right.targetId}:${right.file}`);
}

function isActiveLock(lock) {
  if (!lock) {
    return false;
  }
  if (typeof lock === "string") {
    return lock === "locked" || lock === "active";
  }
  return lock.status === "locked" || lock.active === true;
}

function emptyGovernanceRecordCounts() {
  return {
    review: 0,
    approval: 0,
    verification: 0,
    waiver: 0,
    releaseDecision: 0,
    total: 0
  };
}

async function readOptionalJson(targetPath) {
  if (!(await pathExists(targetPath))) {
    return null;
  }

  try {
    return await readJson(targetPath);
  } catch {
    return null;
  }
}

function toRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}
