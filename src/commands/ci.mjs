import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { resolveRepoRoot } from "../kernel/paths.mjs";
import { inspectRepository } from "../kernel/scaffold.mjs";
import { validateActiveSkills } from "../kernel/agent-skills.mjs";
import { inspectAgentRoles } from "../kernel/agent-roles.mjs";
import { inspectMcpPolicy } from "../kernel/mcp-policy.mjs";
import { inspectSecurityPolicy } from "../kernel/security-policy.mjs";
import { inspectAgentInstructions } from "../kernel/agent-instructions.mjs";
import { runEvals } from "../kernel/evals.mjs";

export async function runCi({ flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);

  if (!(await isInitialized(repoRoot))) {
    return createErrorResult({
      command: "ci",
      cwd: repoRoot,
      code: "NOT_INITIALIZED",
      message: "当前仓库尚未初始化，请先运行 `specnfc init`",
      next: ["运行 `specnfc init --profile standard`"]
    });
  }

  const blockers = [];
  const advisories = [];
  const checks = {};

  const repository = await inspectRepository(repoRoot);
  checks.repository = {
    status: repository.risks?.length || repository.missing?.length ? "failed" : "passed",
    missingCount: repository.missing?.length ?? 0,
    riskCount: repository.risks?.length ?? 0
  };
  for (const missing of repository.missing ?? []) {
    blockers.push({ check: "repository", code: "MISSING_FILE", message: missing });
  }
  for (const risk of repository.risks ?? []) {
    blockers.push({ check: "repository", code: risk.code ?? "RISK", message: risk.message });
  }
  for (const issue of repository.compliance?.blockingIssues ?? []) {
    blockers.push({ check: "compliance", code: issue.code ?? "COMPLIANCE", message: issue.message ?? String(issue) });
  }
  for (const issue of repository.compliance?.advisoryIssues ?? []) {
    advisories.push({ check: "compliance", code: issue.code ?? "COMPLIANCE", message: issue.message ?? String(issue) });
  }

  const skills = await validateActiveSkills({ repoRoot });
  checks.skills = { status: skills.status, total: skills.total, invalidCount: skills.invalidCount };
  if (skills.status === "missing") {
    blockers.push({ check: "skills", code: "SKILLS_MISSING", message: "未生成 Agent Skills 目录" });
  }
  for (const skill of skills.skills.filter((item) => item.status !== "valid")) {
    blockers.push({ check: "skills", code: "SKILL_INVALID", message: `${skill.slug}：${skill.errors.join("；")}` });
  }
  for (const warning of skills.warnings) {
    advisories.push({ check: "skills", code: "SKILL_WARNING", message: warning });
  }

  const roles = await inspectAgentRoles({ repoRoot });
  checks.agentRoles = { status: roles.status, roleCount: roles.roleCount };
  for (const issue of roles.issues ?? []) {
    const target = issue.severity === "blocking" ? blockers : advisories;
    target.push({ check: "agent-roles", code: issue.code, message: issue.message });
  }

  const mcp = await inspectMcpPolicy({ repoRoot });
  checks.mcp = { status: mcp.status, serverCount: mcp.serverCount, protocolVersion: mcp.protocolVersion };
  for (const issue of mcp.issues ?? []) {
    const target = issue.severity === "blocking" ? blockers : advisories;
    target.push({ check: "mcp", code: issue.code, message: issue.message });
  }

  const security = await inspectSecurityPolicy({ repoRoot });
  checks.security = { status: security.status, defaultPolicy: security.defaultPolicy };
  for (const issue of security.issues ?? []) {
    const target = issue.severity === "blocking" ? blockers : advisories;
    target.push({ check: "security", code: issue.code, message: issue.message });
  }

  const instructions = await inspectAgentInstructions({ repoRoot });
  checks.agentInstructions = {
    status: instructions.status,
    lineCount: instructions.lineCount,
    nestedCount: instructions.nested?.length ?? 0
  };
  for (const issue of instructions.issues ?? []) {
    const target = issue.severity === "blocking" ? blockers : advisories;
    target.push({ check: "agent-instructions", code: issue.code, message: issue.message });
  }

  let evalReport = null;
  if (!flags.skipEval) {
    evalReport = await runEvals({
      repoRoot,
      suite: flags.suite ? String(flags.suite) : "smoke",
      caseIds: [],
      dryRun: false,
      allowApproval: Boolean(flags.allowApproval)
    });
    checks.evals = {
      status: evalReport.runId ? evalReport.status : "failed",
      passed: evalReport.totals?.passed ?? 0,
      failed: evalReport.totals?.failed ?? 0,
      runId: evalReport.runId ?? null
    };
    if (!evalReport.runId) {
      blockers.push({ check: "evals", code: "EVAL_INVALID", message: evalReport.errors?.join("；") || "eval 无法运行" });
    } else if (evalReport.status !== "passed") {
      for (const suite of evalReport.suites) {
        for (const item of suite.cases.filter((entry) => entry.status === "failed")) {
          blockers.push({ check: "evals", code: "EVAL_FAILED", message: `${item.id}：${item.failures.join("；")}` });
        }
      }
    }
  }

  const uniqueBlockers = dedupeIssues(blockers);
  const uniqueAdvisories = dedupeIssues(advisories);
  const status = uniqueBlockers.length ? "failed" : uniqueAdvisories.length ? "passed-with-advisories" : "passed";

  return {
    ...createSuccessResult({
      command: "ci",
      cwd: repoRoot,
      data: {
        status,
        checks,
        blockerCount: uniqueBlockers.length,
        advisoryCount: uniqueAdvisories.length,
        blockers: uniqueBlockers,
        advisories: uniqueAdvisories,
        evals: evalReport
          ? {
              runId: evalReport.runId,
              status: evalReport.status,
              totals: evalReport.totals,
              resultsPath: evalReport.resultsPath
            }
          : null
      },
      human: {
        summary: status === "passed" ? "CI 门禁通过。" : status === "passed-with-advisories" ? "CI 门禁通过，但存在提示项。" : `CI 门禁失败：${blockers.length} 个阻塞项。`,
        sections: [
          {
            title: "检查结果",
            items: Object.entries(checks).map(([name, value]) => `${name}：${value.status}`)
          },
          {
            title: "阻塞项",
            items: uniqueBlockers.length ? uniqueBlockers.map((item) => `[${item.check}] ${item.code}：${item.message}`) : ["无"]
          },
          {
            title: "提示项",
            items: uniqueAdvisories.length ? uniqueAdvisories.map((item) => `[${item.check}] ${item.code}：${item.message}`) : ["无"]
          }
        ]
      },
      next: uniqueBlockers.length
        ? ["修复阻塞项后重新运行 `specnfc ci`"]
        : ["如需发布，先确认 release gate 与人工审批"]
    }),
    exitCode: uniqueBlockers.length ? 1 : 0
  };
}

function dedupeIssues(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = `${item.check}\u0000${item.code}\u0000${item.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}