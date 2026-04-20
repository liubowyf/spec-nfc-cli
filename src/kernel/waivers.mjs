import path from "node:path";
import { resolvePathWithin } from "./paths.mjs";
import { assertPathInsideRoot, isDirectory, listDir, pathExists, readJson } from "../utils/fs.mjs";

const WAIVER_ROOT = ".specnfc/governance/waivers";

export async function inspectRepositoryWaivers({ repoRoot, issues = [] }) {
  const waiverRoot = resolvePathWithin(repoRoot, WAIVER_ROOT);
  const report = {
    path: WAIVER_ROOT,
    directoryPresent: false,
    status: "clean",
    totalCount: 0,
    validCount: 0,
    expiredCount: 0,
    invalidCount: 0,
    appliedIssueCodes: [],
    activeWaiverIds: [],
    items: []
  };

  if (!(await pathExists(waiverRoot)) || !(await isDirectory(waiverRoot))) {
    return report;
  }

  report.directoryPresent = true;
  const entries = (await listDir(waiverRoot)).filter((item) => item.endsWith(".json")).sort();
  report.totalCount = entries.length;

  for (const entry of entries) {
    const absolutePath = path.join(waiverRoot, entry);
    await assertPathInsideRoot(repoRoot, absolutePath);
    const relativePath = `${WAIVER_ROOT}/${entry}`;

    try {
      const content = await readJson(absolutePath);
      const normalized = normalizeWaiver(content, relativePath);
      if (!normalized.ok) {
        report.invalidCount += 1;
        report.items.push({
          file: relativePath,
          status: "invalid",
          error: normalized.error,
          appliedIssueCodes: []
        });
        continue;
      }

      const waiver = normalized.value;
      if (isExpired(waiver.validUntil)) {
        report.expiredCount += 1;
        report.items.push({
          ...waiver,
          file: relativePath,
          status: "expired",
          appliedIssueCodes: []
        });
        continue;
      }

      const appliedIssueCodes = Array.from(
        new Set(issues.filter((issue) => waiverAppliesToIssue(waiver, issue)).map((issue) => issue.code))
      ).sort();

      report.validCount += 1;
      report.appliedIssueCodes.push(...appliedIssueCodes);
      report.activeWaiverIds.push(waiver.waiverId);
      report.items.push({
        ...waiver,
        file: relativePath,
        status: "valid",
        appliedIssueCodes
      });
    } catch (error) {
      report.invalidCount += 1;
      report.items.push({
        file: relativePath,
        status: "invalid",
        error: error instanceof Error ? error.message : String(error),
        appliedIssueCodes: []
      });
    }
  }

  report.appliedIssueCodes = Array.from(new Set(report.appliedIssueCodes)).sort();
  report.activeWaiverIds = Array.from(new Set(report.activeWaiverIds)).sort();
  report.status =
    report.invalidCount || report.expiredCount ? "attention" : report.validCount ? "active" : "clean";

  return report;
}

function normalizeWaiver(value, file) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: `${file} 不是有效的 JSON 对象` };
  }

  const waiverId = normalizeString(value.waiverId);
  const scope = normalizeString(value.scope);
  const target = normalizeTarget(value.target);
  const reason = normalizeString(value.reason);
  const approvedBy = normalizeString(value.approvedBy);
  const createdAt = normalizeString(value.createdAt);
  const validUntil = normalizeString(value.validUntil);
  const modeOverride = normalizeString(value.modeOverride);

  if (!waiverId) {
    return { ok: false, error: "缺少 waiverId" };
  }
  if (!scope) {
    return { ok: false, error: "缺少 scope" };
  }
  if (!target.length) {
    return { ok: false, error: "缺少 target" };
  }
  if (!reason) {
    return { ok: false, error: "缺少 reason" };
  }
  if (!approvedBy) {
    return { ok: false, error: "缺少 approvedBy" };
  }
  if (!createdAt) {
    return { ok: false, error: "缺少 createdAt" };
  }

  return {
    ok: true,
    value: {
      waiverId,
      scope,
      target,
      reason,
      approvedBy,
      createdAt,
      validUntil: validUntil || null,
      modeOverride: modeOverride || null
    }
  };
}

function normalizeTarget(value) {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeString(item)).filter(Boolean);
  }

  const single = normalizeString(value);
  return single ? [single] : [];
}

function normalizeString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

function isExpired(validUntil) {
  if (!validUntil) {
    return false;
  }

  const timestamp = Date.parse(validUntil);
  if (Number.isNaN(timestamp)) {
    return true;
  }

  return timestamp < Date.now();
}

function waiverAppliesToIssue(waiver, issue) {
  if (!issue?.code) {
    return false;
  }

  if (waiver.scope && issue.scope && waiver.scope !== issue.scope) {
    return false;
  }

  return waiver.target.some((pattern) => matchesPattern(pattern, issue.code) || matchesPattern(pattern, issue.target));
}

function matchesPattern(pattern, value) {
  if (!pattern || !value) {
    return false;
  }

  if (pattern === value) {
    return true;
  }

  if (pattern.includes("*")) {
    const prefix = pattern.split("*")[0];
    return value.startsWith(prefix);
  }

  if (/^[A-Z0-9_]+_$/.test(pattern)) {
    return value.startsWith(pattern);
  }

  return false;
}
