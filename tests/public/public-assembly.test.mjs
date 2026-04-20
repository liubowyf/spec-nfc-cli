import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ASSEMBLE_PATH = path.join(PROJECT_ROOT, "scripts/assemble-public.mjs");
const PACK_VERIFY_PATH = path.join(PROJECT_ROOT, "scripts/pack-verify.mjs");
const HAS_ASSEMBLER = existsSync(ASSEMBLE_PATH);

test("公开源码面会暴露正确的 manifest 与样例资产", async () => {
  if (!HAS_ASSEMBLER) {
    const publicManifest = JSON.parse(await readFile(path.join(PROJECT_ROOT, "package.json"), "utf8"));
    assert.equal(publicManifest.private, false);
    assert.equal(publicManifest.scripts.test, "node --test tests/public/**/*.test.mjs");
    assert.equal(publicManifest.scripts["pack:verify"], "node ./scripts/pack-verify.mjs --json");
    assert.ok(await readFile(path.join(PROJECT_ROOT, "README.md"), "utf8"));
    assert.ok(await readFile(path.join(PROJECT_ROOT, "CONTRIBUTING.md"), "utf8"));
    assert.ok(await readFile(path.join(PROJECT_ROOT, "SECURITY.md"), "utf8"));
    assert.ok(await readFile(path.join(PROJECT_ROOT, "LICENSE"), "utf8"));
    assert.ok(await readFile(path.join(PROJECT_ROOT, "examples", "README.md"), "utf8"));
    assert.ok(await readFile(path.join(PROJECT_ROOT, "specs", "public-samples", "README.md"), "utf8"));
    return;
  }

  const outputRoot = await mkdtemp(path.join(tmpdir(), "specnfc-public-assembly-"));

  try {
    const result = spawnSync(process.execPath, [ASSEMBLE_PATH, "--output-root", outputRoot, "--json"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8"
    });

    assert.equal(result.status, 0);

    const json = JSON.parse(result.stdout);
    assert.equal(json.ok, true);
    assert.equal(json.targets["github-source"].manifestSummary.private, false);
    assert.equal(json.targets["npm-publish"].manifestSummary.private, false);
    assert.ok(json.targets["github-source"].manifestSummary.scriptNames.includes("test"));
    assert.ok(json.targets["github-source"].manifestSummary.scriptNames.includes("pack:verify"));
    assert.equal(json.targets["github-source"].manifestSummary.hasFilesWhitelist, true);
    assert.equal(json.targets["npm-publish"].manifestSummary.hasFilesWhitelist, true);

    const githubManifest = JSON.parse(await readFile(path.join(outputRoot, "github-source", "package.json"), "utf8"));
    const npmManifest = JSON.parse(await readFile(path.join(outputRoot, "npm-publish", "package.json"), "utf8"));

    assert.equal(githubManifest.private, false);
    assert.equal(githubManifest.scripts.test, "node --test tests/public/**/*.test.mjs");
    assert.equal(githubManifest.scripts["pack:verify"], "node ./scripts/pack-verify.mjs --json");
    assert.ok(Array.isArray(githubManifest.files));
    assert.ok(githubManifest.files.includes("bin"));
    assert.equal(npmManifest.private, false);
    assert.equal(npmManifest.publishConfig.access, "public");
    assert.equal(npmManifest.publishConfig.registry, "https://registry.npmjs.org/");
    assert.ok(Array.isArray(npmManifest.files));
    assert.ok(npmManifest.files.includes("bin"));
    assert.ok(npmManifest.files.includes(".specnfc/design"));
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("pack-verify 会阻断 npm 包中的内部路径泄漏", async () => {
  if (!HAS_ASSEMBLER) {
    const packResult = spawnSync(process.execPath, [PACK_VERIFY_PATH, "--json"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8"
    });

    assert.equal(packResult.status, 0);
    const json = JSON.parse(packResult.stdout);
    assert.equal(json.ok, true);
    assert.deepEqual(json.blockedFiles, []);
    assert.deepEqual(json.sensitiveHits, []);
    return;
  }

  const outputRoot = await mkdtemp(path.join(tmpdir(), "specnfc-public-pack-"));

  try {
    const assembleResult = spawnSync(process.execPath, [ASSEMBLE_PATH, "--output-root", outputRoot, "--json"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8"
    });
    assert.equal(assembleResult.status, 0);

    const packResult = spawnSync(process.execPath, [PACK_VERIFY_PATH, "--cwd", path.join(outputRoot, "npm-publish"), "--json"], {
      cwd: PROJECT_ROOT,
      encoding: "utf8"
    });

    assert.equal(packResult.status, 0);
    const json = JSON.parse(packResult.stdout);
    assert.equal(json.ok, true);
    assert.deepEqual(json.blockedFiles, []);
    assert.deepEqual(json.sensitiveHits, []);
  } finally {
    await rm(outputRoot, { recursive: true, force: true });
  }
});

test("内部源仓执行 pack-verify 会自动装配 npm 发布视图", async () => {
  if (!HAS_ASSEMBLER) {
    return;
  }

  const packResult = spawnSync(process.execPath, [PACK_VERIFY_PATH, "--json"], {
    cwd: PROJECT_ROOT,
    encoding: "utf8"
  });

  assert.equal(packResult.status, 0);
  const json = JSON.parse(packResult.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.assembledPublishView, true);
  assert.equal(json.cwd, "dist/public/npm-publish");
  assert.deepEqual(json.blockedFiles, []);
  assert.deepEqual(json.sensitiveHits, []);
});
