import path from "node:path";
import { getRepoPaths } from "./paths.mjs";
import { ensureDir, isDirectory, listDir, pathExists, readJson, readText, writeJson, writeText } from "../utils/fs.mjs";

const CHANGE_RECORD_TYPES = [
  { type: "review", dir: path.join("evidence", "reviews") },
  { type: "approval", dir: path.join("evidence", "approvals") },
  { type: "verification", dir: path.join("evidence", "verifications") }
];

const INTEGRATION_RECORD_TYPES = CHANGE_RECORD_TYPES;

export async function inspectGovernanceRecords({ repoRoot, repoPaths = getRepoPaths(repoRoot) }) {
  const changeRecords = await collectScopedRecords({ repoRoot, scope: "change", root: repoPaths.changesRoot, definitions: CHANGE_RECORD_TYPES });
  const integrationRecords = await collectScopedRecords({ repoRoot, scope: "integration", root: repoPaths.integrationsRoot, definitions: INTEGRATION_RECORD_TYPES });
  const waiverRecords = await collectRepoRecords({ repoRoot, root: repoPaths.waiverRoot, type: "waiver", key: "waiverId" });
  const releaseDecisionRecords = await collectRepoRecords({
    repoRoot,
    root: repoPaths.releaseDecisionsRoot,
    type: "releaseDecision",
    key: "recordId"
  });
  const releaseDecisionValidation = validateReleaseDecisionRecords({
    releaseDecisionRecords: releaseDecisionRecords.records,
    verificationRecords: [...changeRecords.records, ...integrationRecords.records].filter((item) => item.type === "verification"),
    waiverRecords: waiverRecords.records
  });

  const validRecords = [
    ...changeRecords.records,
    ...integrationRecords.records,
    ...waiverRecords.records,
    ...releaseDecisionValidation.releaseDecisionRecords
  ];
  const invalidRecords = [
    ...changeRecords.invalidRecords,
    ...integrationRecords.invalidRecords,
    ...waiverRecords.invalidRecords,
    ...releaseDecisionRecords.invalidRecords,
    ...releaseDecisionValidation.invalidRecords
  ];

  const recordCounts = {
    review: countByType(validRecords, "review"),
    approval: countByType(validRecords, "approval"),
    verification: countByType(validRecords, "verification"),
    waiver: countByType(validRecords, "waiver"),
    releaseDecision: countByType(validRecords, "releaseDecision")
  };
  recordCounts.total = Object.values(recordCounts).reduce((sum, value) => sum + value, 0);

  const targetSummaries = [...changeRecords.targetSummaries, ...integrationRecords.targetSummaries].sort((left, right) =>
    `${left.scope}:${left.targetId}`.localeCompare(`${right.scope}:${right.targetId}`)
  );
  const invalidSummary = summarizeInvalidRecords(invalidRecords);

  return {
    status: invalidRecords.length ? "attention" : recordCounts.total ? "tracked" : "empty",
    recordCounts,
    targetSummaries,
    invalidRecords,
    invalidCount: invalidRecords.length,
    invalidSummary,
    files: {
      governanceIndexPath: ".nfc/state/governance-index.json",
      governanceEventsLogPath: ".nfc/logs/governance-events.ndjson"
    },
    updatedAt: new Date().toISOString()
  };
}

export async function inspectGovernanceTarget({ repoRoot, scope, targetId, repoPaths = getRepoPaths(repoRoot) }) {
  const normalizedScope = scope === "integration" ? "integration" : "change";
  const definitions = normalizedScope === "integration" ? INTEGRATION_RECORD_TYPES : CHANGE_RECORD_TYPES;
  const root = path.join(normalizedScope === "integration" ? repoPaths.integrationsRoot : repoPaths.changesRoot, targetId);

  return inspectScopedGovernanceTargetRecords({
    repoRoot,
    scope: normalizedScope,
    targetId,
    root,
    definitions
  });
}

export async function syncGovernanceRuntimeArtifacts({ repoRoot, repoPaths = getRepoPaths(repoRoot), governanceRecords }) {
  const payload = {
    runtimeRoot: ".nfc",
    status: governanceRecords.status,
    recordCounts: governanceRecords.recordCounts,
    targetSummaries: governanceRecords.targetSummaries,
    invalidCount: governanceRecords.invalidRecords.length,
    invalidSummary: governanceRecords.invalidSummary,
    updatedAt: new Date().toISOString()
  };

  await writeJson(repoPaths.governanceIndexPath, payload);
  await ensureDir(path.dirname(repoPaths.governanceEventsLogPath));
  const existing = (await pathExists(repoPaths.governanceEventsLogPath)) ? await readText(repoPaths.governanceEventsLogPath) : "";
  const eventLine = JSON.stringify({
    event: "governance-index-refreshed",
    status: payload.status,
    recordCounts: payload.recordCounts,
    targetCount: payload.targetSummaries.length,
    invalidCount: payload.invalidCount,
    invalidSummary: payload.invalidSummary,
    updatedAt: payload.updatedAt
  });
  await writeText(repoPaths.governanceEventsLogPath, `${existing}${eventLine}\n`);
  return payload;
}

async function collectScopedRecords({ repoRoot, scope, root, definitions }) {
  if (!(await pathExists(root))) {
    return { records: [], invalidRecords: [], targetSummaries: [] };
  }

  const entries = await listDir(root);
  const records = [];
  const invalidRecords = [];
  const targetSummaries = [];

  for (const entry of entries) {
    const itemRoot = path.join(root, entry);
    if (!(await isDirectory(itemRoot))) {
      continue;
    }

    const summary = await inspectScopedGovernanceTargetRecords({
      repoRoot,
      scope,
      targetId: entry,
      root: itemRoot,
      definitions
    });

    records.push(...summary.reviewRecords, ...summary.approvalRecords, ...summary.verificationRecords);
    invalidRecords.push(...summary.invalidRecords);

    if (summary.recordCounts.total || summary.invalidCount) {
      targetSummaries.push({
        scope: summary.scope,
        targetId: summary.targetId,
        reviewCount: summary.recordCounts.review,
        approvalCount: summary.recordCounts.approval,
        verificationCount: summary.recordCounts.verification,
        invalidCount: summary.invalidCount
      });
    }
  }

  return { records, invalidRecords, targetSummaries };
}

async function collectRepoRecords({ repoRoot, root, type, key }) {
  if (!(await pathExists(root)) || !(await isDirectory(root))) {
    return { records: [], invalidRecords: [] };
  }

  const entries = (await listDir(root)).filter((item) => item.endsWith(".json")).sort();
  const records = [];
  const invalidRecords = [];

  for (const entry of entries) {
    const filePath = path.join(root, entry);
    try {
      const payload = await readJson(filePath);
      records.push({
        ...payload,
        scope: "repository",
        type,
        targetId: type === "releaseDecision" ? String(payload?.releaseTag || entry.replace(/\.json$/, "")) : "repository",
        recordId: String(payload?.[key] || entry.replace(/\.json$/, "")),
        file: toRelative(repoRoot, filePath)
      });
    } catch {
      invalidRecords.push({
        scope: "repository",
        type,
        targetId: "repository",
        file: toRelative(repoRoot, filePath),
        reason: "JSON_PARSE_FAILED"
      });
    }
  }

  return { records, invalidRecords };
}

async function inspectScopedGovernanceTargetRecords({ repoRoot, scope, targetId, root, definitions }) {
  if (!(await pathExists(root)) || !(await isDirectory(root))) {
    return buildEmptyGovernanceTargetSummary({ scope, targetId });
  }

  const rawRecords = [];
  const invalidRecords = [];

  for (const definition of definitions) {
    const recordRoot = path.join(root, definition.dir);
    if (!(await pathExists(recordRoot)) || !(await isDirectory(recordRoot))) {
      continue;
    }

    const files = (await listDir(recordRoot)).filter((item) => item.endsWith(".json")).sort();
    for (const fileName of files) {
      const filePath = path.join(recordRoot, fileName);
      const parsedRecord = await readScopedGovernanceRecord({
        repoRoot,
        scope,
        targetId,
        type: definition.type,
        fileName,
        filePath
      });

      if (parsedRecord.invalidRecord) {
        invalidRecords.push(parsedRecord.invalidRecord);
        continue;
      }

      rawRecords.push(parsedRecord.record);
    }
  }

  const reviewRecords = rawRecords.filter((item) => item.type === "review");
  const verificationRecords = rawRecords.filter((item) => item.type === "verification");
  const approvalValidation = validateApprovalRecords({
    scope,
    targetId,
    reviewRecords,
    verificationRecords,
    approvalRecords: rawRecords.filter((item) => item.type === "approval")
  });
  invalidRecords.push(...approvalValidation.invalidRecords);

  const records = [...reviewRecords, ...approvalValidation.approvalRecords, ...verificationRecords];

  return buildGovernanceTargetSummary({
    scope,
    targetId,
    reviewRecords,
    approvalRecords: approvalValidation.approvalRecords,
    verificationRecords,
    invalidRecords,
    totalRecordCount: records.length
  });
}

async function readScopedGovernanceRecord({ repoRoot, scope, targetId, type, fileName, filePath }) {
  try {
    const payload = await readJson(filePath);
    const payloadScope = String(payload?.scope || scope);
    const payloadTargetId = String(payload?.targetId || targetId);

    if (payloadScope !== scope) {
      return {
        invalidRecord: {
          scope,
          type,
          targetId,
          file: toRelative(repoRoot, filePath),
          reason: "SCOPE_MISMATCH"
        }
      };
    }

    if (payloadTargetId !== targetId) {
      return {
        invalidRecord: {
          scope,
          type,
          targetId,
          file: toRelative(repoRoot, filePath),
          reason: "TARGET_MISMATCH"
        }
      };
    }

    return {
      record: {
        ...payload,
        scope,
        type,
        targetId,
        recordId: String(payload?.recordId || fileName.replace(/\.json$/, "")),
        file: toRelative(repoRoot, filePath)
      }
    };
  } catch {
    return {
      invalidRecord: {
        scope,
        type,
        targetId,
        file: toRelative(repoRoot, filePath),
        reason: "JSON_PARSE_FAILED"
      }
    };
  }
}

function validateApprovalRecords({ scope, targetId, reviewRecords, verificationRecords, approvalRecords }) {
  const reviewIds = new Set(reviewRecords.map((item) => item.recordId));
  const verificationIds = new Set(verificationRecords.map((item) => item.recordId));
  const validApprovalRecords = [];
  const invalidRecords = [];

  for (const approvalRecord of approvalRecords) {
    const missingReviewRefs = normalizeStringList(approvalRecord.reviewRecordRefs).filter((item) => !reviewIds.has(item));
    const missingVerificationRefs = normalizeStringList(approvalRecord.verificationRecordRefs).filter((item) => !verificationIds.has(item));

    if (missingReviewRefs.length || missingVerificationRefs.length) {
      invalidRecords.push({
        scope,
        type: "approval",
        targetId,
        file: approvalRecord.file,
        reason: "MISSING_RELATED_RECORD_REF",
        missingReviewRefs,
        missingVerificationRefs
      });
      continue;
    }

    validApprovalRecords.push(approvalRecord);
  }

  return {
    approvalRecords: validApprovalRecords,
    invalidRecords
  };
}

function validateReleaseDecisionRecords({ releaseDecisionRecords, verificationRecords, waiverRecords }) {
  const verificationIds = new Set(verificationRecords.map((item) => item.recordId));
  const waiverIds = new Set(waiverRecords.map((item) => item.recordId));
  const validReleaseDecisionRecords = [];
  const invalidRecords = [];

  for (const releaseDecisionRecord of releaseDecisionRecords) {
    const missingVerificationRefs = normalizeStringList(releaseDecisionRecord.verificationRecordRefs).filter((item) => !verificationIds.has(item));
    const missingWaiverRefs = normalizeStringList(releaseDecisionRecord.waiverRefs).filter((item) => !waiverIds.has(item));

    if (missingVerificationRefs.length || missingWaiverRefs.length) {
      invalidRecords.push({
        scope: "repository",
        type: "releaseDecision",
        targetId: releaseDecisionRecord.targetId,
        file: releaseDecisionRecord.file,
        reason: "MISSING_RELATED_RECORD_REF",
        missingVerificationRefs,
        missingWaiverRefs
      });
      continue;
    }

    validReleaseDecisionRecords.push(releaseDecisionRecord);
  }

  return {
    releaseDecisionRecords: validReleaseDecisionRecords,
    invalidRecords
  };
}

function buildGovernanceTargetSummary({
  scope,
  targetId,
  reviewRecords,
  approvalRecords,
  verificationRecords,
  invalidRecords,
  totalRecordCount
}) {
  return {
    scope,
    targetId,
    status: invalidRecords.length ? "attention" : totalRecordCount ? "tracked" : "empty",
    reviewRecords,
    approvalRecords,
    verificationRecords,
    invalidRecords,
    invalidCount: invalidRecords.length,
    invalidSummary: summarizeInvalidRecords(invalidRecords),
    recordCounts: {
      review: reviewRecords.length,
      approval: approvalRecords.length,
      verification: verificationRecords.length,
      total: totalRecordCount
    },
    gateSummary: {
      hasReview: reviewRecords.length > 0,
      hasRejectedReview: reviewRecords.some((item) => item.verdict === "rejected"),
      hasPassedVerification: verificationRecords.some(isPassedVerificationRecord),
      hasApprovedApproval: approvalRecords.some(isApprovedApprovalRecord)
    }
  };
}

function summarizeInvalidRecords(invalidRecords, sampleLimit = 3) {
  const byReason = {};
  const byType = {};

  for (const record of invalidRecords) {
    const reason = String(record?.reason || "UNKNOWN");
    const type = String(record?.type || "unknown");
    byReason[reason] = (byReason[reason] || 0) + 1;
    byType[type] = (byType[type] || 0) + 1;
  }

  return {
    byReason,
    byType,
    samples: invalidRecords.slice(0, sampleLimit).map((record) => ({
      scope: record.scope,
      targetId: record.targetId,
      type: record.type,
      file: record.file,
      reason: record.reason,
      ...(record.missingReviewRefs?.length ? { missingReviewRefs: record.missingReviewRefs } : {}),
      ...(record.missingVerificationRefs?.length ? { missingVerificationRefs: record.missingVerificationRefs } : {}),
      ...(record.missingWaiverRefs?.length ? { missingWaiverRefs: record.missingWaiverRefs } : {})
    }))
  };
}

function countByType(records, type) {
  return records.filter((item) => item.type === type).length;
}

function buildEmptyGovernanceTargetSummary({ scope, targetId }) {
  return {
    scope,
    targetId,
    status: "empty",
    reviewRecords: [],
    approvalRecords: [],
    verificationRecords: [],
    invalidRecords: [],
    invalidCount: 0,
    invalidSummary: summarizeInvalidRecords([]),
    recordCounts: {
      review: 0,
      approval: 0,
      verification: 0,
      total: 0
    },
    gateSummary: {
      hasReview: false,
      hasRejectedReview: false,
      hasPassedVerification: false,
      hasApprovedApproval: false
    }
  };
}

function isPassedVerificationRecord(record) {
  return String(record?.result || "").toLowerCase() === "passed";
}

function isApprovedApprovalRecord(record) {
  if (String(record?.decision || "").toLowerCase() !== "approved") {
    return false;
  }

  if (!record?.validUntil) {
    return true;
  }

  const validUntil = new Date(record.validUntil);
  return !Number.isNaN(validUntil.getTime()) && validUntil.getTime() >= Date.now();
}

function normalizeStringList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function toRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}
