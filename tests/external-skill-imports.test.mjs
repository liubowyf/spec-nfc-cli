import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const CLI_PATH = path.join(PROJECT_ROOT, "bin/specnfc.mjs");

function isoDaysFromNow(days) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

test("status 会汇总外部 skills 导入物的 namespace / trust tier / 待回写状态", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "specnfc-external-import-status-"));

  try {
    const initResult = runCli(["init", "--cwd", cwd, "--profile", "enterprise", "--json"]);
    assert.equal(initResult.status, 0);

    await createExternalImportFixture(cwd, "run-001", {
      meta: {
        adapterId: "adapter-run-001",
        source: "codex",
        sourceSkillId: "my-local-skill",
        version: "1.0.0",
        owner: "dev-a",
        namespace: "personal.codex",
        trustTier: "workspace",
        scope: "change",
        targetId: "demo-change",
        stage: "execute",
        outputArtifacts: ["artifacts/notes.md"],
        evidenceRefs: ["specs/changes/demo-change/status.md"],
        requestedWritebacks: [{ targetDocPath: "specs/changes/demo-change/status.md", writebackType: "append" }],
        createdAt: isoDaysFromNow(-1)
      },
      writebackRequest: {
        requestedWritebacks: [{ targetDocPath: "specs/changes/demo-change/status.md", writebackType: "append" }],
        completed: false
      },
      securityLabel: {
        classification: "internal",
        containsSensitiveData: false,
        owner: "dev-a",
        createdAt: isoDaysFromNow(-1),
        expiresAt: isoDaysFromNow(14),
        accessPolicy: "project-members"
      }
    });

    const result = runCli(["status", "--cwd", cwd, "--json"]);
    assert.equal(result.status, 0);
    const json = JSON.parse(result.stdout);

    assert.equal(json.data.repo.externalSkillImports.totalCount, 1);
    assert.equal(json.data.repo.externalSkillImports.pendingWritebackCount, 1);
    assert.deepEqual(json.data.repo.externalSkillImports.namespaces, ["personal.codex"]);
    assert.deepEqual(json.data.repo.externalSkillImports.trustTiers, ["workspace"]);
    assert.equal(json.data.repo.externalSkillImports.items[0].retentionStatus, "active");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

test("doctor 会把 governed 外部导入物未写回、过保留期与安全违规纳入阻塞", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "specnfc-external-import-doctor-"));

  try {
    const initResult = runCli(["init", "--cwd", cwd, "--profile", "enterprise", "--json"]);
    assert.equal(initResult.status, 0);

    await createExternalImportFixture(cwd, "run-002", {
      meta: {
        adapterId: "adapter-run-002",
        source: "claude-code",
        sourceSkillId: "dangerous-skill",
        version: "9.9.9",
        owner: "dev-b",
        namespace: "personal.claude",
        trustTier: "governed",
        scope: "change",
        targetId: "demo-change",
        stage: "verify",
        outputArtifacts: ["artifacts/raw-sensitive.txt"],
        evidenceRefs: ["specs/changes/demo-change/acceptance.md"],
        requestedWritebacks: [{ targetDocPath: "specs/changes/demo-change/acceptance.md", writebackType: "replace" }],
        createdAt: isoDaysFromNow(-10)
      },
      writebackRequest: {
        requestedWritebacks: [{ targetDocPath: "specs/changes/demo-change/acceptance.md", writebackType: "replace" }],
        completed: false
      },
      securityLabel: {
        classification: "sensitive",
        containsSensitiveData: true,
        owner: "dev-b",
        createdAt: isoDaysFromNow(-10),
        expiresAt: isoDaysFromNow(-1),
        accessPolicy: "governance-only"
      }
    });

    const result = runCli(["doctor", "--cwd", cwd, "--json"]);
    assert.equal(result.status, 0);
    const json = JSON.parse(result.stdout);

    assert.equal(json.data.externalSkillImports.totalCount, 1);
    assert.equal(json.data.externalSkillImports.governedPendingWritebackCount, 1);
    assert.equal(json.data.externalSkillImports.expiredCount, 1);
    assert.equal(json.data.externalSkillImports.securityViolationCount, 1);
    assert.ok(json.data.compliance.blockingIssues.some((item) => item.startsWith("EXTERNAL_SKILL_GOVERNED_PENDING_WRITEBACK")));
    assert.ok(json.data.compliance.blockingIssues.some((item) => item.startsWith("EXTERNAL_SKILL_RETENTION_EXPIRED")));
    assert.ok(json.data.compliance.blockingIssues.some((item) => item.startsWith("EXTERNAL_SKILL_SECURITY_POLICY_VIOLATION")));
    assert.ok(json.data.compliance.recommendedActions.some((item) => item.includes("governed 外部 skill 导入物")));
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});

async function createExternalImportFixture(cwd, runId, { meta, writebackRequest, securityLabel }) {
  const runRoot = path.join(cwd, ".nfc/imports", runId);
  await mkdir(path.join(runRoot, "artifacts"), { recursive: true });
  await writeFile(path.join(runRoot, "artifacts", "notes.md"), "# import artifact\n", "utf8");
  await writeFile(path.join(runRoot, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  await writeFile(
    path.join(runRoot, "evidence.json"),
    `${JSON.stringify({ evidenceRefs: meta.evidenceRefs || [] }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(path.join(runRoot, "writeback-request.json"), `${JSON.stringify(writebackRequest, null, 2)}\n`, "utf8");
  await writeFile(path.join(runRoot, "security-label.json"), `${JSON.stringify(securityLabel, null, 2)}\n`, "utf8");
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [CLI_PATH, ...args], {
    cwd: options.cwd ?? PROJECT_ROOT,
    encoding: "utf8"
  });
}
