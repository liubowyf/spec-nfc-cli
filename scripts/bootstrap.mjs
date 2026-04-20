#!/usr/bin/env node

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, "..");
const options = parseArgs(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

const repoRoot = path.resolve(process.cwd(), options.cwd || PROJECT_ROOT);
const nodeVersion = process.versions.node;
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const specnfcCommand = process.platform === "win32" ? "specnfc.cmd" : "specnfc";
const localCliPath = path.join(repoRoot, "bin", "specnfc.mjs");
const repoValidation = validateBootstrapRepo(repoRoot, localCliPath);

if (!repoValidation.ok) {
  finish(
    {
      ok: false,
      mode: options.json ? "json" : "human",
      cwd: repoRoot,
      error: {
        code: repoValidation.code,
        message: repoValidation.message,
        failedStep: null,
        details: repoValidation.details
      },
      data: {
        nodeVersion,
        steps: []
      }
    },
    options
  );
}

const majorVersion = Number.parseInt(nodeVersion.split(".")[0] || "0", 10);
if (Number.isNaN(majorVersion) || majorVersion < 20) {
  finish(
    {
      ok: false,
      mode: options.json ? "json" : "human",
      cwd: repoRoot,
      error: {
        code: "NODE_VERSION_UNSUPPORTED",
        message: `当前 Node.js 版本为 ${nodeVersion}，需要 >= 20`,
        failedStep: null,
        details: ""
      },
      data: {
        nodeVersion,
        steps: []
      }
    },
    options
  );
}

const steps = [
  {
    id: "npm-install",
    label: "安装依赖",
    command: npmCommand,
    args: ["install"]
  }
];

if (!options.skipTest) {
  steps.push({
    id: "npm-test",
    label: "执行测试",
    command: npmCommand,
    args: ["test"]
  });
}

if (!options.skipLink) {
  steps.push({
    id: "npm-link",
    label: "创建全局命令",
    command: npmCommand,
    args: ["link"]
  });
}

steps.push({
  id: "verify-local-cli",
  label: "验证本地 CLI",
  command: process.execPath,
  args: [localCliPath, "version", "--json"]
});

if (!options.skipLink) {
  steps.push({
    id: "verify-global-cli",
    label: "验证全局命令",
    command: specnfcCommand,
    args: ["version", "--json"]
  });
}

if (!options.json) {
  process.stdout.write("Spec nfc 一键安装\n");
  process.stdout.write(`目录：${repoRoot}\n`);
  process.stdout.write(`Node.js：${nodeVersion}\n`);
  process.stdout.write(`模式：${options.dryRun ? "dry-run" : "执行"}\n`);
  process.stdout.write(`测试：${options.skipTest ? "跳过" : "执行"}\n`);
  process.stdout.write(`全局命令：${options.skipLink ? "跳过" : "执行"}\n`);
}

const stepResults = [];

for (let index = 0; index < steps.length; index += 1) {
  const step = steps[index];
  const renderedCommand = [step.command, ...step.args].join(" ");

  if (options.dryRun) {
    if (!options.json) {
      process.stdout.write(`\n[${index + 1}/${steps.length}] ${step.label}\n`);
      process.stdout.write(`命令：${renderedCommand}\n`);
      process.stdout.write("状态：dry-run，未执行\n");
    }

    stepResults.push({
      id: step.id,
      label: step.label,
      command: renderedCommand,
      status: "planned"
    });
    continue;
  }

  if (!options.json) {
    process.stdout.write(`\n[${index + 1}/${steps.length}] ${step.label}\n`);
    process.stdout.write(`命令：${renderedCommand}\n`);
    process.stdout.write("状态：执行中\n");
  }

  const result = spawnSync(step.command, step.args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    stdio: options.json ? "pipe" : "inherit"
  });

  const stepResult = {
    id: step.id,
    label: step.label,
    command: renderedCommand,
    status: result.status === 0 ? "completed" : "failed",
    exitCode: result.status ?? 1
  };

  if (options.json && result.status !== 0) {
    stepResult.stdout = tailText(result.stdout);
    stepResult.stderr = tailText(result.stderr);
  }

  stepResults.push(stepResult);

  if (result.error || result.status !== 0) {
    if (!options.json) {
      process.stderr.write("状态：失败\n");
    }

    finish(
      {
        ok: false,
        mode: options.json ? "json" : "human",
        cwd: repoRoot,
        error: {
          code: "BOOTSTRAP_STEP_FAILED",
          message: `${step.label}失败`,
          failedStep: step.id,
          details: result.error ? String(result.error.message || result.error) : tailText(result.stderr)
        },
        data: {
          nodeVersion,
          steps: stepResults
        }
      },
      options
    );
  }

  if (!options.json) {
    process.stdout.write("状态：完成\n");
  }
}

finish(
  {
    ok: true,
    mode: options.json ? "json" : "human",
    cwd: repoRoot,
    data: {
      nodeVersion,
      dryRun: options.dryRun,
      skipTest: options.skipTest,
      skipLink: options.skipLink,
      steps: stepResults,
      successCriteria: [
        "本地 CLI 可执行 `node ./bin/specnfc.mjs version`",
        options.skipLink ? "已跳过全局命令验证" : "全局命令可执行 `specnfc version`"
      ]
    }
  },
  options
);

function parseArgs(argv) {
  const parsed = {
    help: false,
    json: false,
    dryRun: false,
    skipTest: false,
    skipLink: false,
    cwd: null
  };

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index];

    if (current === "--help" || current === "-h") {
      parsed.help = true;
      continue;
    }

    if (current === "--json") {
      parsed.json = true;
      continue;
    }

    if (current === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }

    if (current === "--skip-test") {
      parsed.skipTest = true;
      continue;
    }

    if (current === "--skip-link") {
      parsed.skipLink = true;
      continue;
    }

    if (current === "--cwd") {
      parsed.cwd = argv[index + 1] || null;
      index += 1;
    }
  }

  return parsed;
}

function validateBootstrapRepo(repoRoot, localCliPath) {
  const packageJsonPath = path.join(repoRoot, "package.json");
  if (!existsSync(packageJsonPath)) {
    return {
      ok: false,
      code: "PACKAGE_JSON_MISSING",
      message: "目标目录下未找到 package.json，请在 Spec nfc 仓库根目录执行",
      details: ""
    };
  }

  let packageJson;
  try {
    packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  } catch (error) {
    return {
      ok: false,
      code: "INVALID_PACKAGE_JSON",
      message: "目标目录下的 package.json 无法解析，无法确认是否为 Spec nfc 仓库",
      details: error instanceof Error ? error.message : String(error)
    };
  }

  if (packageJson.name !== "spec-nfc" || !existsSync(localCliPath)) {
    return {
      ok: false,
      code: "INVALID_BOOTSTRAP_ROOT",
      message: "bootstrap 只允许在完整的 Spec nfc 源码仓根目录执行",
      details: `package.name=${packageJson.name || "unknown"}; missingCli=${String(!existsSync(localCliPath))}`
    };
  }

  return {
    ok: true
  };
}

function tailText(value, maxLines = 20) {
  if (!value) {
    return "";
  }

  return String(value)
    .trim()
    .split("\n")
    .slice(-maxLines)
    .join("\n");
}

function printHelp() {
  process.stdout.write(`# Spec nfc 一键安装脚本

用法：
  node ./scripts/bootstrap.mjs [参数]

常用参数：
  --dry-run     只输出安装计划，不真正执行
  --skip-test   跳过 npm test
  --skip-link   跳过 npm link 和全局命令验证
  --cwd <路径>  指定仓库根目录
  --json        输出结构化结果，便于 Agent 解析
  --help        查看帮助

示例：
  npm run bootstrap
  npm run bootstrap -- --dry-run
  npm run bootstrap -- --json
  node ./scripts/bootstrap.mjs --skip-test --skip-link
`);
}

function finish(result, options) {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(result.ok ? 0 : 1);
  }

  if (result.ok) {
    process.stdout.write("\n安装完成\n");
    process.stdout.write("- 可执行 `specnfc version` 验证全局命令\n");
    process.stdout.write("- 可执行 `specnfc explain install` 查看安装说明\n");
    process.exit(0);
  }

  process.stderr.write(`\n安装失败：${result.error.message}\n`);
  if (result.error.failedStep) {
    process.stderr.write(`失败步骤：${result.error.failedStep}\n`);
  }
  if (result.error.details) {
    process.stderr.write(`细节：\n${result.error.details}\n`);
  }
  process.stderr.write("建议：先执行 `node ./scripts/bootstrap.mjs --dry-run` 检查步骤，再处理环境问题。\n");
  process.exit(1);
}
