import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ensureDir, pathExists, readJson, writeJson } from "../utils/fs.mjs";
import { PERMISSIONS_PATH } from "./security-policy.mjs";

export const EVALS_MANIFEST_PATH = ".specnfc/evals/manifest.json";
export const EVALS_RESULTS_ROOT = ".nfc/evals/results";

export function buildDefaultEvalManifest() {
  return {
    version: 1,
    defaults: {
      timeoutMs: 120000,
      failFast: false
    },
    suites: {
      smoke: {
        description: "协议骨架最小健康检查：配置可解析、入口文件存在、Agent Skills 已生成",
        cases: [
          {
            id: "protocol-config",
            description: "config.json 可解析",
            command: "node -e \"JSON.parse(require('node:fs').readFileSync('.specnfc/config.json','utf8'))\"",
            expect: { exitCode: 0 },
            timeoutMs: 30000,
            tags: ["protocol", "fast"]
          },
          {
            id: "entry-files",
            description: "AGENTS.md 与 repo contract 存在",
            command: "node -e \"const fs=require('node:fs');for(const f of ['AGENTS.md','.specnfc/contract/repo.json']){if(!fs.existsSync(f))process.exit(1)}\"",
            expect: { exitCode: 0 },
            timeoutMs: 30000,
            tags: ["protocol", "fast"]
          },
          {
            id: "skill-standard",
            description: "至少生成一个符合 Agent Skills 结构的 SKILL.md",
            command: "node -e \"const fs=require('node:fs');const p='.specnfc/skill-packs/active/skills';const n=fs.existsSync(p)?fs.readdirSync(p).filter(d=>fs.existsSync(p+'/'+d+'/SKILL.md')).length:0;process.exit(n>0?0:1)\"",
            expect: { exitCode: 0 },
            timeoutMs: 30000,
            tags: ["skills", "fast"]
          }
        ]
      }
    }
  };
}

export function validateEvalManifest(manifest) {
  const errors = [];
  const warnings = [];

  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    return { valid: false, errors: ["manifest 必须是 JSON 对象"], warnings };
  }
  if (!manifest.suites || typeof manifest.suites !== "object" || Array.isArray(manifest.suites)) {
    return { valid: false, errors: ["manifest.suites 必须是对象"], warnings };
  }

  const suiteNames = Object.keys(manifest.suites);
  if (!suiteNames.length) {
    warnings.push("manifest 没有定义任何 suite");
  }

  const caseIds = new Set();
  for (const suiteName of suiteNames) {
    const suite = manifest.suites[suiteName];
    if (!suite || typeof suite !== "object" || !Array.isArray(suite.cases)) {
      errors.push(`suite ${suiteName} 缺少 cases 数组`);
      continue;
    }

    for (const [index, evalCase] of suite.cases.entries()) {
      const label = `${suiteName}.cases[${index}]`;
      const id = String(evalCase?.id ?? "").trim();
      if (!id) {
        errors.push(`${label} 缺少 id`);
      } else if (caseIds.has(id)) {
        errors.push(`case id 重复：${id}`);
      } else {
        caseIds.add(id);
      }
      if (typeof evalCase?.command !== "string" || !evalCase.command.trim()) {
        errors.push(`${label} 缺少 command`);
      }
      if (evalCase?.expect !== undefined && (typeof evalCase.expect !== "object" || Array.isArray(evalCase.expect))) {
        errors.push(`${label}.expect 必须是对象`);
      }
      if (evalCase?.timeoutMs !== undefined && (!Number.isInteger(evalCase.timeoutMs) || evalCase.timeoutMs <= 0)) {
        errors.push(`${label}.timeoutMs 必须是正整数`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export async function loadEvalManifest({ repoRoot }) {
  const manifestPath = path.join(repoRoot, EVALS_MANIFEST_PATH);
  if (!(await pathExists(manifestPath))) {
    return {
      status: "missing",
      path: EVALS_MANIFEST_PATH,
      manifest: null,
      errors: ["缺少 eval manifest"],
      warnings: []
    };
  }

  try {
    const manifest = await readJson(manifestPath);
    const validation = validateEvalManifest(manifest);
    return {
      status: validation.valid ? "valid" : "invalid",
      path: EVALS_MANIFEST_PATH,
      manifest,
      errors: validation.errors,
      warnings: validation.warnings
    };
  } catch (error) {
    return {
      status: "invalid",
      path: EVALS_MANIFEST_PATH,
      manifest: null,
      errors: [`manifest 无法解析：${error instanceof Error ? error.message : String(error)}`],
      warnings: []
    };
  }
}

export async function runEvals({ repoRoot, suite = null, caseIds = [], dryRun = false, allowApproval = false }) {
  const loaded = await loadEvalManifest({ repoRoot });
  if (loaded.status !== "valid") {
    return {
      ok: false,
      reason: loaded.status,
      errors: loaded.errors,
      suite,
      runId: null
    };
  }

  const manifest = loaded.manifest;
  const selectedSuiteNames = suite ? [suite] : Object.keys(manifest.suites);
  const missingSuites = selectedSuiteNames.filter((name) => !manifest.suites[name]);
  if (missingSuites.length) {
    return {
      ok: false,
      reason: "suite-not-found",
      errors: [`未找到 suite：${missingSuites.join("、")}`],
      suite,
      runId: null
    };
  }

  const selectedCases = new Set(caseIds.filter(Boolean));
  const permissions = await loadEvalPermissions({ repoRoot });
  const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
  const startedAt = new Date().toISOString();
  const suiteResults = [];
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const suiteName of selectedSuiteNames) {
    const suiteDefinition = manifest.suites[suiteName];
    const cases = [];

    for (const evalCase of suiteDefinition.cases) {
      if (selectedCases.size && !selectedCases.has(evalCase.id)) {
        continue;
      }
      if (dryRun) {
        skipped += 1;
        cases.push({ id: evalCase.id, status: "skipped", reason: "dry-run" });
        continue;
      }

      const result = executeEvalCase({
        repoRoot,
        evalCase,
        defaults: manifest.defaults ?? {},
        runId,
        suiteName,
        permissions,
        allowApproval
      });
      if (result.status === "passed") {
        passed += 1;
      } else {
        failed += 1;
      }
      cases.push(result);

      if (manifest.defaults?.failFast && result.status !== "passed") {
        break;
      }
    }

    suiteResults.push({
      name: suiteName,
      description: suiteDefinition.description ?? "",
      cases
    });
  }

  const finishedAt = new Date().toISOString();
  const report = {
    runId,
    traceId: runId,
    status: failed ? "failed" : "passed",
    startedAt,
    finishedAt,
    suiteFilter: suite,
    totals: { passed, failed, skipped, total: passed + failed + skipped },
    suites: suiteResults
  };

  if (!dryRun) {
    const resultsPath = path.join(repoRoot, EVALS_RESULTS_ROOT, `${runId}.json`);
    await ensureDir(path.dirname(resultsPath));
    await writeJson(resultsPath, report);
    report.resultsPath = toRelative(repoRoot, resultsPath);
  }

  return { ok: failed === 0, ...report };
}

function executeEvalCase({ repoRoot, evalCase, defaults, runId, suiteName, permissions, allowApproval }) {
  const timeoutMs = evalCase.timeoutMs ?? defaults.timeoutMs ?? 120000;
  const startedAt = Date.now();
  const policyFailure = evaluateCommandPolicy({ command: evalCase.command, permissions, allowApproval });

  if (policyFailure) {
    return {
      id: evalCase.id,
      description: evalCase.description ?? "",
      status: "failed",
      exitCode: null,
      timedOut: false,
      durationMs: 0,
      failures: [policyFailure],
      blockedByPolicy: true,
      stdoutTail: "",
      stderrTail: ""
    };
  }

  const env = buildEvalEnvironment({
    runId,
    caseId: evalCase.id,
    suiteName
  });

  const shell = process.platform === "win32" ? "cmd.exe" : "/bin/sh";
  const shellArgs = process.platform === "win32" ? ["/d", "/s", "/c", evalCase.command] : ["-c", evalCase.command];
  const result = spawnSync(shell, shellArgs, {
    cwd: repoRoot,
    timeout: timeoutMs,
    encoding: "utf8",
    env
  });

  const durationMs = Date.now() - startedAt;
  const exitCode = result.status;
  const timedOut = Boolean(result.error && result.error.code === "ETIMEDOUT");
  const failures = evaluateExpectations({
    repoRoot,
    expect: evalCase.expect ?? {},
    exitCode,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    timedOut
  });

  return {
    id: evalCase.id,
    description: evalCase.description ?? "",
    status: failures.length ? "failed" : "passed",
    exitCode,
    timedOut,
    durationMs,
    failures,
    stdoutTail: tail(result.stdout ?? ""),
    stderrTail: tail(result.stderr ?? "")
  };
}

function evaluateExpectations({ repoRoot, expect, exitCode, stdout, stderr, timedOut }) {
  const failures = [];

  if (timedOut) {
    failures.push("命令超时");
  }

  if (expect.exitCode !== undefined) {
    const allowed = Array.isArray(expect.exitCode) ? expect.exitCode : [expect.exitCode];
    if (!allowed.includes(exitCode)) {
      failures.push(`exitCode 期望 ${allowed.join("/")}，实际 ${exitCode}`);
    }
  }

  for (const text of expect.stdoutIncludes ?? []) {
    if (!stdout.includes(text)) {
      failures.push(`stdout 缺少：${text}`);
    }
  }
  for (const text of expect.stdoutExcludes ?? []) {
    if (stdout.includes(text)) {
      failures.push(`stdout 不应包含：${text}`);
    }
  }
  for (const text of expect.stderrIncludes ?? []) {
    if (!stderr.includes(text)) {
      failures.push(`stderr 缺少：${text}`);
    }
  }
  for (const relativePath of expect.fileExists ?? []) {
    if (!pathExistsSync(repoRoot, relativePath)) {
      failures.push(`文件不存在：${relativePath}`);
    }
  }

  return failures;
}

function pathExistsSync(repoRoot, relativePath) {
  const resolved = path.resolve(repoRoot, relativePath);
  const relative = path.relative(path.resolve(repoRoot), resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  return existsSync(resolved);
}

async function loadEvalPermissions({ repoRoot }) {
  const permissionsPath = path.join(repoRoot, PERMISSIONS_PATH);
  if (!(await pathExists(permissionsPath))) {
    return null;
  }
  try {
    return await readJson(permissionsPath);
  } catch {
    return null;
  }
}

function evaluateCommandPolicy({ command, permissions, allowApproval }) {
  const text = String(command ?? "");
  const denyPatterns = Array.isArray(permissions?.commands?.deny) ? permissions.commands.deny : [];
  const denied = denyPatterns.find((pattern) => pattern && text.includes(pattern));
  if (denied) {
    return `命令命中 permissions.commands.deny：${denied}`;
  }

  const approvalPatterns = Array.isArray(permissions?.commands?.requireApproval)
    ? permissions.commands.requireApproval
    : [];
  const needsApproval = approvalPatterns.find((pattern) => pattern && text.includes(pattern));
  if (needsApproval && !allowApproval) {
    return `命令需要显式审批（--allow-approval）：${needsApproval}`;
  }

  return null;
}

const EVAL_ENV_KEYS = ["PATH", "HOME", "TMPDIR", "TEMP", "TMP", "LANG", "LC_ALL", "CI"];

function buildEvalEnvironment({ runId, caseId, suiteName }) {
  const env = {};
  for (const key of EVAL_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  env.SPECNFC_EVAL_RUN_ID = runId;
  env.SPECNFC_EVAL_CASE_ID = caseId;
  env.SPECNFC_EVAL_SUITE = suiteName;
  return env;
}

function tail(text, limit = 4000) {
  const value = String(text ?? "");
  return value.length <= limit ? value : value.slice(value.length - limit);
}

function toRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}