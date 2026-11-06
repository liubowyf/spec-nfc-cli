import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { resolveRepoRoot } from "../kernel/paths.mjs";
import { loadEvalManifest, runEvals } from "../kernel/evals.mjs";

export async function runEval({ args, flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const action = args[0] ?? "run";

  if (!(await isInitialized(repoRoot))) {
    return createErrorResult({
      command: "eval",
      cwd: repoRoot,
      code: "NOT_INITIALIZED",
      message: "当前仓库尚未初始化，请先运行 `specnfc init`",
      next: ["运行 `specnfc init --profile standard`"]
    });
  }

  if (action === "validate") {
    const loaded = await loadEvalManifest({ repoRoot });
    return {
      ...createSuccessResult({
        command: "eval",
        cwd: repoRoot,
        data: loaded,
        human: {
          summary: loaded.status === "valid" ? "eval manifest 有效。" : "eval manifest 存在问题。",
          sections: [
            {
              title: "校验结果",
              items: [
                `状态：${loaded.status}`,
                ...loaded.errors.map((error) => `错误：${error}`),
                ...loaded.warnings.map((warning) => `提示：${warning}`)
              ]
            }
          ]
        },
        next: loaded.status === "valid" ? ["运行 `specnfc eval run`"] : ["修复 `.specnfc/evals/manifest.json`"]
      }),
      exitCode: loaded.status === "valid" ? 0 : 1
    };
  }

  if (action === "list") {
    const loaded = await loadEvalManifest({ repoRoot });
    if (loaded.status !== "valid") {
      return createErrorResult({
        command: "eval",
        cwd: repoRoot,
        code: "INVALID_CONFIG",
        message: "eval manifest 无效",
        next: ["运行 `specnfc eval validate` 查看问题"]
      });
    }

    const suites = Object.entries(loaded.manifest.suites).map(([name, suite]) => ({
      name,
      description: suite.description ?? "",
      caseCount: suite.cases.length,
      cases: suite.cases.map((item) => ({ id: item.id, description: item.description ?? "" }))
    }));

    return createSuccessResult({
      command: "eval",
      cwd: repoRoot,
      data: { suites },
      human: {
        summary: `共 ${suites.length} 个 suite`,
        sections: suites.map((suite) => ({
          title: `${suite.name}（${suite.caseCount} 个用例）`,
          items: suite.cases.map((item) => `${item.id}：${item.description}`)
        }))
      },
      next: ["运行 `specnfc eval run --suite <name>`"]
    });
  }

  if (action === "run") {
    const caseIds = String(flags.case ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    try {
      const report = await runEvals({
        repoRoot,
        suite: flags.suite ? String(flags.suite) : null,
        caseIds,
        dryRun: Boolean(flags.dryRun),
        allowApproval: Boolean(flags.allowApproval)
      });

      if (!report.ok && report.runId === null) {
        return createErrorResult({
          command: "eval",
          cwd: repoRoot,
          code: "INVALID_CONFIG",
          message: report.errors?.join("；") || "eval 无法运行",
          next: ["运行 `specnfc eval validate` 查看 manifest 问题"]
        });
      }

      const failedCases = report.suites.flatMap((suite) =>
        suite.cases.filter((item) => item.status === "failed").map((item) => ({ suite: suite.name, ...item }))
      );

      return {
        ...createSuccessResult({
          command: "eval",
          cwd: repoRoot,
          data: report,
          warnings: failedCases.map((item) => `${item.id}：${item.failures.join("；")}`),
          human: {
            summary: flags.dryRun
              ? "eval 计划已生成（dry-run）。"
              : report.status === "passed"
                ? `eval 通过：${report.totals.passed}/${report.totals.total}`
                : `eval 失败：${report.totals.failed} 个用例未通过`,
            sections: [
              {
                title: "执行摘要",
                items: [
                  `runId：${report.runId}`,
                  `通过：${report.totals.passed}`,
                  `失败：${report.totals.failed}`,
                  `跳过：${report.totals.skipped}`,
                  ...(report.resultsPath ? [`结果文件：${report.resultsPath}`] : [])
                ]
              },
              ...report.suites.map((suite) => ({
                title: `Suite ${suite.name}`,
                items: suite.cases.map((item) => `${item.id}：${item.status}${item.durationMs !== undefined ? `（${item.durationMs}ms）` : ""}`)
              }))
            ]
          },
          next: report.status === "passed"
            ? ["运行 `specnfc ci` 做完整门禁"]
            : ["根据失败用例修复后重新运行 `specnfc eval run`"]
        }),
        exitCode: report.status === "passed" || flags.dryRun ? 0 : 1
      };
    } catch (error) {
      return createErrorResult({
        command: "eval",
        cwd: repoRoot,
        code: "INVALID_CONFIG",
        message: error instanceof Error ? error.message : "eval 执行失败",
        next: ["检查 `.specnfc/evals/manifest.json`"]
      });
    }
  }

  return createErrorResult({
    command: "eval",
    cwd: repoRoot,
    code: "INVALID_ARGS",
    message: `未识别的 eval 子命令：${action}`,
    next: ["支持的子命令：run、list、validate"]
  });
}