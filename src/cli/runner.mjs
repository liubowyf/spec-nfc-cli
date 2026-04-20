import { parseArgv } from "./parser.mjs";
import { createErrorResult, mapErrorCodeToExitCode, printResult } from "./output.mjs";
import { runInit } from "../commands/init.mjs";
import { runAdd } from "../commands/add.mjs";
import { runChange } from "../commands/change.mjs";
import { runDemo } from "../commands/demo.mjs";
import { runDoctor } from "../commands/doctor.mjs";
import { runStatus } from "../commands/status.mjs";
import { runExplain } from "../commands/explain.mjs";
import { runUpgrade } from "../commands/upgrade.mjs";
import { runVersion } from "../commands/version.mjs";
import { runIntegration } from "../commands/integration.mjs";
import { getHelpPath, resolveRepoRoot } from "../kernel/paths.mjs";
import { readText } from "../utils/fs.mjs";

const COMMANDS = {
  init: runInit,
  add: runAdd,
  change: runChange,
  demo: runDemo,
  doctor: runDoctor,
  status: runStatus,
  explain: runExplain,
  upgrade: runUpgrade,
  version: runVersion,
  integration: runIntegration
};

export async function runCli(argv, runtime) {
  const parsed = parseArgv(argv);
  const asJson = Boolean(parsed.flags.json);

  if (!parsed.command || parsed.flags.help) {
    const helpTarget =
      parsed.command && COMMANDS[parsed.command]
        ? getHelpPath("commands", `${parsed.command}.md`)
        : getHelpPath("commands", "root.md");
    const help = await readText(helpTarget);
    const result = {
      ok: true,
      command: parsed.command ?? "help",
      cwd: runtime.cwd,
      data: {
        content: help
      },
      human: {
        summary: parsed.command
          ? `${parsed.command} 命令说明`
          : "Spec nfc：Spec-driven Coding 协议与 CLI 工具",
        sections: [
          {
            title: "帮助内容",
            items: help.trim().split("\n"),
            preformatted: true
          }
        ]
      },
      warnings: [],
      next: []
    };
    await printResult(result, { asJson, stdout: runtime.stdout, stderr: runtime.stderr });
    return 0;
  }

  const handler = COMMANDS[parsed.command];
  if (!handler) {
    const result = createErrorResult({
      command: parsed.command,
      cwd: resolveRepoRoot(parsed.flags.cwd, runtime.cwd),
      code: "INVALID_ARGS",
      message: `未识别的命令：${parsed.command}`,
      next: ["运行 `specnfc --help` 查看支持的命令"]
    });
    await printResult(result, { asJson, stdout: runtime.stdout, stderr: runtime.stderr });
    return mapErrorCodeToExitCode(result.error.code);
  }

  try {
    const result = await handler({
      args: parsed.args,
      flags: parsed.flags,
      runtime
    });
    await printResult(result, { asJson, stdout: runtime.stdout, stderr: runtime.stderr });
    return result.ok ? 0 : mapErrorCodeToExitCode(result.error.code);
  } catch (error) {
    const result = createErrorResult({
      command: parsed.command,
      cwd: resolveRepoRoot(parsed.flags.cwd, runtime.cwd),
      code: "WRITE_DENIED",
      message: error instanceof Error ? error.message : "发生未知错误",
      next: ["运行 `specnfc doctor` 检查当前仓状态"]
    });
    await printResult(result, { asJson, stdout: runtime.stdout, stderr: runtime.stderr });
    return mapErrorCodeToExitCode(result.error.code);
  }
}
