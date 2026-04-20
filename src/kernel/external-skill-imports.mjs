import path from "node:path";
import { getRepoPaths } from "./paths.mjs";
import { isDirectory, listDir, pathExists, readJson } from "../utils/fs.mjs";

const REQUIRED_META_FIELDS = [
  "adapterId",
  "source",
  "sourceSkillId",
  "version",
  "owner",
  "namespace",
  "trustTier",
  "scope",
  "targetId",
  "stage",
  "outputArtifacts",
  "evidenceRefs",
  "requestedWritebacks",
  "createdAt"
];

const VALID_TRUST_TIERS = new Set(["readonly", "workspace", "governed"]);
const VALID_CLASSIFICATIONS = new Set(["public", "internal", "restricted", "sensitive"]);

export async function inspectExternalSkillImports({ repoRoot, repoPaths = getRepoPaths(repoRoot) }) {
  if (!(await pathExists(repoPaths.importsRoot)) || !(await isDirectory(repoPaths.importsRoot))) {
    return emptyExternalSkillImports();
  }

  const entries = (await listDir(repoPaths.importsRoot)).sort();
  const items = [];
  const advisories = [];
  let invalidCount = 0;
  let pendingWritebackCount = 0;
  let governedPendingWritebackCount = 0;
  let expiredCount = 0;
  let securityViolationCount = 0;

  for (const entry of entries) {
    const runRoot = path.join(repoPaths.importsRoot, entry);
    if (!(await isDirectory(runRoot))) {
      continue;
    }

    const inspected = await inspectImportRun({ repoRoot, runId: entry, runRoot });
    items.push(inspected);

    if (inspected.status === "invalid") {
      invalidCount += 1;
      advisories.push({
        code: "EXTERNAL_SKILL_IMPORT_INVALID",
        runId: entry,
        message: `外部 skill 导入物损坏：${entry}`,
        action: `修复 \`.nfc/imports/${entry}/\` 下的结构与 JSON 后重新运行 \`specnfc doctor\``
      });
    }
    if (inspected.pendingWriteback) {
      pendingWritebackCount += 1;
    }
    if (inspected.trustTier === "governed" && inspected.pendingWriteback) {
      governedPendingWritebackCount += 1;
      advisories.push({
        code: "EXTERNAL_SKILL_GOVERNED_PENDING_WRITEBACK",
        runId: entry,
        message: `governed 外部 skill 导入物仍有待回写：${entry}`,
        action: `完成 \`.nfc/imports/${entry}/writeback-request.json\` 对应写回后再发布`
      });
    }
    if (inspected.retentionStatus === "retention-expired") {
      expiredCount += 1;
      advisories.push({
        code: "EXTERNAL_SKILL_RETENTION_EXPIRED",
        runId: entry,
        message: `外部 skill 导入物已过保留期：${entry}`,
        action: `清理或续期 \`.nfc/imports/${entry}/security-label.json\` 后重新运行 \`specnfc doctor\``
      });
    }
    if (inspected.securityStatus === "violation") {
      securityViolationCount += 1;
      advisories.push({
        code: "EXTERNAL_SKILL_SECURITY_POLICY_VIOLATION",
        runId: entry,
        message: `外部 skill 导入物违反安全留存策略：${entry}`,
        action: `按安全策略脱敏或移除 \`.nfc/imports/${entry}/artifacts/\` 后重新运行 \`specnfc doctor\``
      });
    }
  }

  const namespaces = Array.from(new Set(items.map((item) => item.namespace).filter(Boolean))).sort();
  const trustTiers = Array.from(new Set(items.map((item) => item.trustTier).filter(Boolean))).sort();
  const status = invalidCount || securityViolationCount || governedPendingWritebackCount || expiredCount
    ? "attention"
    : items.length
      ? "tracked"
      : "empty";

  return {
    status,
    totalCount: items.length,
    invalidCount,
    pendingWritebackCount,
    governedPendingWritebackCount,
    expiredCount,
    securityViolationCount,
    namespaces,
    trustTiers,
    items,
    advisories
  };
}

function emptyExternalSkillImports() {
  return {
    status: "empty",
    totalCount: 0,
    invalidCount: 0,
    pendingWritebackCount: 0,
    governedPendingWritebackCount: 0,
    expiredCount: 0,
    securityViolationCount: 0,
    namespaces: [],
    trustTiers: [],
    items: [],
    advisories: []
  };
}

async function inspectImportRun({ repoRoot, runId, runRoot }) {
  const metaPath = path.join(runRoot, "meta.json");
  const evidencePath = path.join(runRoot, "evidence.json");
  const writebackPath = path.join(runRoot, "writeback-request.json");
  const securityLabelPath = path.join(runRoot, "security-label.json");
  const artifactsRoot = path.join(runRoot, "artifacts");

  const problems = [];
  const meta = await readOptionalJson(metaPath, problems, "meta.json");
  const evidence = await readOptionalJson(evidencePath, problems, "evidence.json");
  const writebackRequest = await readOptionalJson(writebackPath, problems, "writeback-request.json");
  const securityLabel = await readOptionalJson(securityLabelPath, problems, "security-label.json");

  if (!(await pathExists(artifactsRoot)) || !(await isDirectory(artifactsRoot))) {
    problems.push("artifacts/ 缺失");
  }

  validateMeta(meta, problems);
  validateSecurityLabel(securityLabel, problems);

  const requestedWritebacks = Array.isArray(writebackRequest?.requestedWritebacks)
    ? writebackRequest.requestedWritebacks
    : Array.isArray(meta?.requestedWritebacks)
      ? meta.requestedWritebacks
      : [];
  const pendingWriteback = requestedWritebacks.length > 0 && writebackRequest?.completed !== true;

  const retentionStatus = resolveRetentionStatus(securityLabel);
  const securityStatus = resolveSecurityStatus({ securityLabel, meta, runRoot, problems });

  return {
    runId,
    path: toRelative(repoRoot, runRoot),
    status: problems.length ? "invalid" : "valid",
    namespace: meta?.namespace ?? null,
    trustTier: meta?.trustTier ?? null,
    stage: meta?.stage ?? null,
    scope: meta?.scope ?? null,
    targetId: meta?.targetId ?? null,
    source: meta?.source ?? null,
    pendingWriteback,
    retentionStatus,
    securityStatus,
    evidenceRefCount: Array.isArray(evidence?.evidenceRefs) ? evidence.evidenceRefs.length : Array.isArray(meta?.evidenceRefs) ? meta.evidenceRefs.length : 0,
    requestedWritebackCount: requestedWritebacks.length,
    problems
  };
}

async function readOptionalJson(targetPath, problems, label) {
  if (!(await pathExists(targetPath))) {
    problems.push(`${label} 缺失`);
    return null;
  }

  try {
    return await readJson(targetPath);
  } catch {
    problems.push(`${label} 不是合法 JSON`);
    return null;
  }
}

function validateMeta(meta, problems) {
  if (!meta || typeof meta !== "object") {
    return;
  }

  for (const field of REQUIRED_META_FIELDS) {
    if (meta[field] === undefined || meta[field] === null || meta[field] === "") {
      problems.push(`meta.json 缺少字段：${field}`);
    }
  }

  if (meta.trustTier && !VALID_TRUST_TIERS.has(String(meta.trustTier))) {
    problems.push(`meta.json trustTier 非法：${meta.trustTier}`);
  }
}

function validateSecurityLabel(securityLabel, problems) {
  if (!securityLabel || typeof securityLabel !== "object") {
    return;
  }

  const requiredFields = ["classification", "containsSensitiveData", "owner", "createdAt", "expiresAt", "accessPolicy"];
  for (const field of requiredFields) {
    if (securityLabel[field] === undefined || securityLabel[field] === null || securityLabel[field] === "") {
      problems.push(`security-label.json 缺少字段：${field}`);
    }
  }

  if (securityLabel.classification && !VALID_CLASSIFICATIONS.has(String(securityLabel.classification))) {
    problems.push(`security-label.json classification 非法：${securityLabel.classification}`);
  }
}

function resolveRetentionStatus(securityLabel) {
  if (!securityLabel?.expiresAt) {
    return "unknown";
  }

  const expiresAt = new Date(securityLabel.expiresAt);
  if (Number.isNaN(expiresAt.getTime())) {
    return "invalid";
  }

  return expiresAt.getTime() < Date.now() ? "retention-expired" : "active";
}

function resolveSecurityStatus({ securityLabel, meta, runRoot, problems }) {
  if (!securityLabel) {
    return "unknown";
  }

  if (securityLabel.classification === "sensitive" && securityLabel.containsSensitiveData === true) {
    return "violation";
  }

  if (meta?.trustTier === "governed" && problems.some((item) => item.includes("security-label.json"))) {
    return "violation";
  }

  return "ok";
}

function toRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}
