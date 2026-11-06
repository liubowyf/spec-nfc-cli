import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { resolveRepoRoot } from "../kernel/paths.mjs";
import { inspectTraceability, writeTraceabilityReport } from "../kernel/traceability.mjs";
import { normalizeChangeId } from "../workflow/changes.mjs";

export async function runTrace({ args, flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const changeId = normalizeChangeId(args[0]);

  if (!(await isInitialized(repoRoot))) {
    return createErrorResult({
      command: "trace",
      cwd: repoRoot,
      code: "NOT_INITIALIZED",
      message: "当前仓库尚未初始化，请先运行 `specnfc init`",
      next: ["运行 `specnfc init --profile standard`"]
    });
  }

  if (!changeId) {
    return createErrorResult({
      command: "trace",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "未提供 change-id",
      next: ["示例：`specnfc trace risk-device-link`"]
    });
  }

  const report = await inspectTraceability({ repoRoot, changeId });
  if (report.status === "missing") {
    return createErrorResult({
      command: "trace",
      cwd: repoRoot,
      code: "CHANGE_NOT_FOUND",
      message: `change 不存在：${changeId}`,
      next: ["运行 `specnfc change list` 查看已有 change"]
    });
  }

  const written = flags.noWrite ? null : await writeTraceabilityReport({ repoRoot, changeId, report });
  const strictFailure = Boolean(flags.strict) && report.status === "gaps";

  return {
    ...createSuccessResult({
      command: "trace",
      cwd: repoRoot,
      data: {
        ...report,
        reportPath: written?.path ?? null
      },
      human: {
        summary:
          report.status === "not-adopted"
            ? "当前 change 尚未使用可追溯 ID。"
            : report.status === "complete"
              ? "需求、验收、任务与证据链完整。"
              : `发现 ${report.gaps.length} 个追溯缺口。`,
        sections: [
          {
            title: "覆盖统计",
            items: [
              `需求（REQ）：${report.counts.requirements}`,
              `验收标准（AC）：${report.counts.acceptanceCriteria}`,
              `任务（TASK）：${report.counts.tasks}`,
              `证据（EV）：${report.counts.evidence}`,
              `扫描文档：${report.counts.documents}`,
              ...(written?.path ? [`报告：${written.path}`] : [])
            ]
          },
          {
            title: "缺口",
            items: report.gaps.length
              ? report.gaps.map((gap) => `${gap.code}：${gap.message}`)
              : ["无"]
          }
        ]
      },
      next:
        report.status === "not-adopted"
          ? ["按模板为需求、验收标准、任务与证据添加 REQ/AC/TASK/EV 编号"]
          : report.gaps.length
            ? ["补齐缺口后重新运行 `specnfc trace <change-id>`"]
            : ["运行 `specnfc change check <change-id>` 进入后续门禁"]
    }),
    exitCode: strictFailure ? 1 : 0
  };
}