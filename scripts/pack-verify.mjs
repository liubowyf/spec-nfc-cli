#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const CONFIG_PATH = path.join(PROJECT_ROOT, "public", "assembly.config.json");

const options = parseArgs(process.argv.slice(2));
const cwd = path.resolve(options.cwd || process.cwd());
const config = existsSync(CONFIG_PATH)
  ? JSON.parse(readFileSync(CONFIG_PATH, "utf8"))
  : {
      audit: {
        blacklistTerms: [],
        whitelistTerms: []
      }
    };
const blockedPrefixes = [
  ".omx/",
  ".serena/",
  ".nfc/",
  "docs/",
  "dist/",
  "tests/",
  "specs/",
  "examples/",
  "scripts/release.mjs"
];

if (options.help) {
  printHelp();
  process.exit(0);
}

const packResult = spawnSync("npm", ["pack", "--dry-run", "--json"], {
  cwd,
  encoding: "utf8"
});

if (packResult.status !== 0) {
  finish(
    {
      ok: false,
      cwd: toRelative(cwd),
      error: {
        code: "PACK_VERIFY_COMMAND_FAILED",
        message: "npm pack --dry-run --json 执行失败",
        details: (packResult.stderr || packResult.stdout || "").trim()
      }
    },
    options
  );
  process.exit(1);
}

const packJson = JSON.parse(packResult.stdout);
const files = Array.isArray(packJson) && packJson[0]?.files ? packJson[0].files.map((item) => item.path) : [];
const blocked = files.filter((file) => blockedPrefixes.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix)));
const hits = scanBlacklist(files, config.audit?.blacklistTerms || [], config.audit?.whitelistTerms || []);

const result = {
  ok: blocked.length === 0 && hits.length === 0,
  cwd: toRelative(cwd),
  packageName: packJson[0]?.name ?? null,
  fileCount: files.length,
  blockedFiles: blocked,
  sensitiveHits: hits,
  checkedAt: new Date().toISOString()
};

finish(result, options);
process.exit(result.ok ? 0 : 1);

function scanBlacklist(files, blacklistTerms, whitelistTerms) {
  const whitelist = new Set(whitelistTerms || []);
  return files.flatMap((file) => {
    const normalized = String(file);
    return blacklistTerms
      .filter((term) => normalized.includes(term) && !whitelist.has(term))
      .map((term) => ({ file: normalized, term }));
  });
}

function parseArgs(argv) {
  const parsed = {
    cwd: null,
    json: false,
    help: false
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--cwd") {
      parsed.cwd = argv[index + 1] || null;
      index += 1;
      continue;
    }
    if (token === "--json") {
      parsed.json = true;
      continue;
    }
    if (token === "--help" || token === "-h") {
      parsed.help = true;
    }
  }
  return parsed;
}

function finish(result, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  process.stdout.write(`pack 验证目录：${result.cwd}\n`);
  process.stdout.write(`文件数：${result.fileCount ?? 0}\n`);
  process.stdout.write(`阻断文件：${result.blockedFiles?.length ?? 0}\n`);
  process.stdout.write(`敏感词命中：${result.sensitiveHits?.length ?? 0}\n`);
}

function toRelative(targetPath) {
  return path.relative(PROJECT_ROOT, targetPath).split(path.sep).join("/");
}

function printHelp() {
  process.stdout.write(`Spec nfc pack 验证脚本

用法：
  node ./scripts/pack-verify.mjs [--cwd <package-root>] [--json]
`);
}
