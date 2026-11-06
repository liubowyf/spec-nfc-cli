import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { assertDesignSchemaMatches } from "./helpers/output-contracts.mjs";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLI_PATH = path.join(PROJECT_ROOT, "bin/specnfc.mjs");

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd ?? PROJECT_ROOT,
    encoding: "utf8",
    env: options.env ? { ...process.env, ...options.env } : process.env
  });
}

async function initRepo(prefix, profile = "standard") {
  const cwd = await mkdtemp(path.join(tmpdir(), prefix));
  const result = runCli(["init", "--cwd", cwd, "--profile", profile, "--json"]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return cwd;
}

async function readJson(targetPath) {
  return JSON.parse(await readFile(targetPath, "utf8"));
}

test("init 生成 Agent Skills、MCP 策略、权限清单、角色目录与 eval manifest", async () => {
  const cwd = await initRepo("specnfc-agent-native-init-", "enterprise");

  try {
    const skillPath = path.join(cwd, ".specnfc/skill-packs/active/skills/clarify/SKILL.md");
    const skill = await readFile(skillPath, "utf8");
    assert.match(skill, /^---\nname: clarify\n/);
    assert.match(skill, /description: /);
    assert.match(skill, /specnfc\.layer: workflow/);

    const mcp = await readJson(path.join(cwd, ".specnfc/mcp/policy.json"));
    assert.equal(mcp.protocolVersion, "2026-07-28");
    assert.equal(mcp.defaults.trustTier, "untrusted");
    assert.equal(mcp.phaseToolPolicy.clarify.writeTools, "deny");
    await assertDesignSchemaMatches("mcp-policy.schema.json", mcp, { root: cwd });

    const permissions = await readJson(path.join(cwd, ".specnfc/security/permissions.json"));
    assert.equal(permissions.default, "deny");
    assert.equal(permissions.untrustedContent.policy, "no-instruction-execution");
    assert.ok(permissions.filesystem.deny.includes(".git/**"));
    await assertDesignSchemaMatches("permission-manifest.schema.json", permissions, { root: cwd });

    const roles = await readJson(path.join(cwd, ".specnfc/agents/roles.json"));
    assert.ok(roles.roles.some((role) => role.name === "orchestrator"));
    assert.ok(roles.roles.some((role) => role.name === "executor" && role.isolation === "worktree"));
    await assertDesignSchemaMatches("agent-role.schema.json", roles, { root: cwd });

    const taskTemplate = await readJson(path.join(cwd, ".specnfc/agents/task-template.json"));
    await assertDesignSchemaMatches("agent-task.schema.json", taskTemplate, { root: cwd });

    const roleDoc = await readFile(path.join(cwd, ".specnfc/agents/roles/executor.md"), "utf8");
    assert.match(roleDoc, /^---\nname: executor\n/);
    assert.match(roleDoc, /tools: /);

    const evals = await readJson(path.join(cwd, ".specnfc/evals/manifest.json"));
    assert.equal(evals.suites.smoke.cases.length, 3);
    await assertDesignSchemaMatches("eval-suite.schema.json", evals, { root: cwd });

    for (const schema of [
      "agent-skill.schema.json",
      "mcp-policy.schema.json",
      "agent-role.schema.json",
      "agent-task.schema.json",
      "eval-suite.schema.json",
      "permission-manifest.schema.json",
      "traceability.schema.json"
    ]) {
      await readFile(path.join(cwd, ".specnfc/design", schema), "utf8");
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("skills validate 能识别非法 frontmatter，export 能导出可移植目录", async () => {
  const cwd = await initRepo("specnfc-agent-skills-");

  try {
    const validate = runCli(["skills", "validate", "--cwd", cwd, "--json"]);
    assert.equal(validate.status, 0);
    const validated = JSON.parse(validate.stdout);
    assert.equal(validated.data.status, "valid");
    assert.ok(validated.data.total >= 20);

    const skillPath = path.join(cwd, ".specnfc/skill-packs/active/skills/clarify/SKILL.md");
    const broken = (await readFile(skillPath, "utf8")).replace("name: clarify", "name: Clarify_Skill");
    await writeFile(skillPath, broken, "utf8");

    const invalid = runCli(["skills", "validate", "--cwd", cwd, "--json"]);
    assert.equal(invalid.status, 1);
    const invalidJson = JSON.parse(invalid.stdout);
    assert.equal(invalidJson.data.status, "invalid");
    assert.ok(invalidJson.data.skills.find((skill) => skill.slug === "clarify").errors.length > 0);

    await writeFile(skillPath, broken.replace("name: Clarify_Skill", "name: clarify"), "utf8");

    const exportResult = runCli(["skills", "export", "--cwd", cwd, "--to", "skills", "--json"]);
    assert.equal(exportResult.status, 0);
    const exported = JSON.parse(exportResult.stdout);
    assert.ok(exported.data.exported.includes("skills/clarify/SKILL.md"));
    const exportedSkill = await readFile(path.join(cwd, "skills/clarify/SKILL.md"), "utf8");
    assert.match(exportedSkill, /^---\nname: clarify\n/);

    const second = runCli(["skills", "export", "--cwd", cwd, "--to", "skills", "--json"]);
    assert.equal(second.status, 0);
    assert.ok(JSON.parse(second.stdout).data.skipped.length > 0);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("agents validate / export / task 形成可委派的角色与任务契约", async () => {
  const cwd = await initRepo("specnfc-agent-roles-");

  try {
    const validate = runCli(["agents", "validate", "--cwd", cwd, "--json"]);
    assert.equal(validate.status, 0);
    const report = JSON.parse(validate.stdout);
    assert.equal(report.data.status, "valid");
    assert.ok(report.data.coverage.execute.includes("executor"));

    const exported = runCli(["agents", "export", "--cwd", cwd, "--to", ".claude/agents", "--json"]);
    assert.equal(exported.status, 0);
    const exportedJson = JSON.parse(exported.stdout);
    assert.ok(exportedJson.data.exported.includes(".claude/agents/orchestrator.md"));
    const roleDoc = await readFile(path.join(cwd, ".claude/agents/orchestrator.md"), "utf8");
    assert.match(roleDoc, /^---\nname: orchestrator\n/);

    const created = runCli(["change", "create", "agent-demo", "--cwd", cwd, "--title", "Agent 演示", "--json"]);
    assert.equal(created.status, 0);

    const task = runCli(["agents", "task", "executor", "--cwd", cwd, "--change", "agent-demo", "--json"]);
    assert.equal(task.status, 0);
    const taskJson = JSON.parse(task.stdout);
    assert.equal(taskJson.data.task.role, "executor");
    assert.equal(taskJson.data.task.isolation.mode, "worktree");
    assert.match(taskJson.data.task.traceId, /^trace-/);
    await readFile(path.join(cwd, taskJson.data.path), "utf8");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("eval run 默认通过，失败用例返回非零并落盘结果", async () => {
  const cwd = await initRepo("specnfc-agent-eval-");

  try {
    const list = runCli(["eval", "list", "--cwd", cwd, "--json"]);
    assert.equal(list.status, 0);
    assert.equal(JSON.parse(list.stdout).data.suites[0].name, "smoke");

    const run = runCli(["eval", "run", "--cwd", cwd, "--json"]);
    assert.equal(run.status, 0);
    const runJson = JSON.parse(run.stdout);
    assert.equal(runJson.data.status, "passed");
    assert.equal(runJson.data.totals.failed, 0);
    await readFile(path.join(cwd, runJson.data.resultsPath), "utf8");

    const manifestPath = path.join(cwd, ".specnfc/evals/manifest.json");
    const manifest = await readJson(manifestPath);
    manifest.suites.smoke.cases.push({
      id: "intentional-failure",
      description: "故意失败",
      command: "node -e \"process.exit(1)\"",
      expect: { exitCode: 0 },
      timeoutMs: 30000
    });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const failed = runCli(["eval", "run", "--cwd", cwd, "--json"]);
    assert.equal(failed.status, 1);
    const failedJson = JSON.parse(failed.stdout);
    assert.equal(failedJson.data.status, "failed");
    assert.ok(failedJson.data.totals.failed >= 1);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("trace 生成 REQ/AC/TASK/EV 覆盖矩阵并能以 strict 模式阻断缺口", async () => {
  const cwd = await initRepo("specnfc-agent-trace-");

  try {
    const created = runCli(["change", "create", "trace-demo", "--cwd", cwd, "--title", "追溯演示", "--json"]);
    assert.equal(created.status, 0);

    const complete = runCli(["trace", "trace-demo", "--cwd", cwd, "--json"]);
    assert.equal(complete.status, 0);
    const completeJson = JSON.parse(complete.stdout);
    assert.equal(completeJson.data.status, "complete");
    assert.equal(completeJson.data.counts.requirements, 2);
    assert.equal(completeJson.data.matrix.requirements["REQ-001"].acceptance[0], "AC-001");
    await assertDesignSchemaMatches("traceability.schema.json", completeJson.data, { root: cwd });
    await readFile(path.join(cwd, completeJson.data.reportPath), "utf8");

    const acceptancePath = path.join(cwd, "specs/changes/trace-demo/04-验收与交接.md");
    const acceptance = await readFile(acceptancePath, "utf8");
    await writeFile(acceptancePath, acceptance.replace(/- EV-00[12]（AC-00[12]）：\n/g, ""), "utf8");

    const gap = runCli(["trace", "trace-demo", "--cwd", cwd, "--strict", "--json"]);
    assert.equal(gap.status, 1);
    const gapJson = JSON.parse(gap.stdout);
    assert.equal(gapJson.data.status, "gaps");
    assert.ok(gapJson.data.gaps.some((item) => item.code === "ACCEPTANCE_WITHOUT_EVIDENCE"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("security check 能阻断过宽权限与危险命令", async () => {
  const cwd = await initRepo("specnfc-agent-security-");

  try {
    const clean = runCli(["security", "check", "--cwd", cwd, "--json"]);
    assert.equal(clean.status, 0);
    assert.equal(JSON.parse(clean.stdout).data.status, "valid");

    const permissionsPath = path.join(cwd, ".specnfc/security/permissions.json");
    const permissions = await readJson(permissionsPath);
    permissions.default = "allow";
    permissions.filesystem.write = ["**"];
    permissions.commands.allow.push("rm -rf /", "sudo");
    permissions.network = { egress: "allow", allowHosts: [] };
    permissions.untrustedContent.policy = "trusted";
    await writeFile(permissionsPath, `${JSON.stringify(permissions, null, 2)}\n`, "utf8");

    const blocked = runCli(["security", "check", "--cwd", cwd, "--json"]);
    assert.equal(blocked.status, 1);
    const blockedJson = JSON.parse(blocked.stdout);
    const codes = blockedJson.data.issues.map((issue) => issue.code);
    assert.ok(codes.includes("PERMISSIONS_WRITE_TOO_BROAD"));
    assert.ok(codes.includes("PERMISSIONS_PROTECTED_WRITE"));
    assert.ok(codes.includes("PERMISSIONS_DANGEROUS_ALLOW"));
    assert.ok(codes.includes("PERMISSIONS_NETWORK_UNBOUNDED"));
    assert.ok(codes.includes("PERMISSIONS_UNTRUSTED_CONTENT_WEAK"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("ci 汇总 MCP / 权限 / 角色 / AGENTS 标准并在越界配置下失败", async () => {
  const cwd = await initRepo("specnfc-agent-ci-");

  try {
    const clean = runCli(["ci", "--cwd", cwd, "--json"]);
    assert.equal(clean.status, 0, clean.stdout);
    const cleanJson = JSON.parse(clean.stdout);
    assert.equal(cleanJson.data.blockerCount, 0);
    assert.ok(cleanJson.data.checks.skills.status === "valid");
    assert.ok(cleanJson.data.checks.evals.status === "passed");

    const policyPath = path.join(cwd, ".specnfc/mcp/policy.json");
    const policy = await readJson(policyPath);
    policy.servers.push({
      name: "unsafe-server",
      transport: "streamable-http",
      trustTier: "untrusted",
      allowedTools: ["*"],
      writeAccess: true
    });
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

    const blocked = runCli(["ci", "--cwd", cwd, "--json"]);
    assert.equal(blocked.status, 1);
    const blockedJson = JSON.parse(blocked.stdout);
    assert.equal(blockedJson.data.status, "failed");
    const codes = blockedJson.data.blockers.map((item) => item.code);
    assert.ok(codes.includes("MCP_TOOLS_WILDCARD"));
    assert.ok(codes.includes("MCP_UNTRUSTED_WRITE"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("eval 会执行权限清单并隔离敏感环境变量", async () => {
  const cwd = await initRepo("specnfc-agent-eval-policy-");

  try {
    const manifestPath = path.join(cwd, ".specnfc/evals/manifest.json");
    const manifest = await readJson(manifestPath);
    manifest.suites.smoke.cases.push(
      {
        id: "env-isolation",
        description: "子进程不应继承 GITHUB_TOKEN",
        command: "node -e \"process.exit(process.env.GITHUB_TOKEN ? 1 : 0)\"",
        expect: { exitCode: 0 },
        timeoutMs: 30000
      },
      {
        id: "denied-command",
        description: "命中 deny 的命令不得执行",
        command: "echo curl https://example.com",
        expect: { exitCode: 0 },
        timeoutMs: 30000
      }
    );
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const envIsolation = runCli(["eval", "run", "--case", "env-isolation", "--cwd", cwd, "--json"], {
      env: { GITHUB_TOKEN: "should-not-leak" }
    });
    assert.equal(envIsolation.status, 0, envIsolation.stdout);

    const denied = runCli(["eval", "run", "--case", "denied-command", "--cwd", cwd, "--json"]);
    assert.equal(denied.status, 1);
    const deniedJson = JSON.parse(denied.stdout);
    const caseReport = deniedJson.data.suites[0].cases[0];
    assert.equal(caseReport.status, "failed");
    assert.equal(caseReport.blockedByPolicy, true);
    assert.match(caseReport.failures.join("；"), /commands\.deny/);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("skills export 拒绝通过符号链接写出仓库", async () => {
  const cwd = await initRepo("specnfc-agent-symlink-");
  const outside = await mkdtemp(path.join(tmpdir(), "specnfc-outside-"));

  try {
    await symlink(outside, path.join(cwd, "skills"));
    const result = runCli(["skills", "export", "--cwd", cwd, "--to", "skills", "--force", "--json"]);
    assert.equal(result.status, 3);
    const json = JSON.parse(result.stdout);
    assert.equal(json.error.code, "WRITE_DENIED");
  } finally {
    await rm(cwd, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("upgrade 保留团队自定义的权限与 MCP 策略", async () => {
  const cwd = await initRepo("specnfc-agent-preserve-");

  try {
    const permissionsPath = path.join(cwd, ".specnfc/security/permissions.json");
    const permissions = await readJson(permissionsPath);
    permissions.commands.deny.push("team-forbidden-tool");
    await writeFile(permissionsPath, `${JSON.stringify(permissions, null, 2)}\n`, "utf8");

    const policyPath = path.join(cwd, ".specnfc/mcp/policy.json");
    const policy = await readJson(policyPath);
    policy.servers.push({
      name: "team-internal",
      transport: "streamable-http",
      trustTier: "workspace",
      authorization: "oauth",
      allowedTools: ["search"]
    });
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");

    const upgrade = runCli(["upgrade", "--cwd", cwd, "--json"]);
    assert.equal(upgrade.status, 0, upgrade.stdout);

    const permissionsAfter = await readJson(permissionsPath);
    assert.ok(permissionsAfter.commands.deny.includes("team-forbidden-tool"));
    const policyAfter = await readJson(policyPath);
    assert.ok(policyAfter.servers.some((server) => server.name === "team-internal"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("doctor 能报告 AGENTS.md 超过规模上限与嵌套入口", async () => {
  const cwd = await initRepo("specnfc-agent-instructions-");

  try {
    const agentsPath = path.join(cwd, "AGENTS.md");
    const content = await readFile(agentsPath, "utf8");
    await writeFile(agentsPath, `${content}\n${"extra line\n".repeat(500)}`, "utf8");

    const doctor = runCli(["doctor", "--cwd", cwd, "--json"]);
    assert.equal(doctor.status, 0);
    const report = JSON.parse(doctor.stdout);
    assert.equal(report.data.agentInstructions.status, "invalid");
    assert.ok(report.data.agentInstructions.issues.some((issue) => issue.code === "AGENTS_TOO_LONG"));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});