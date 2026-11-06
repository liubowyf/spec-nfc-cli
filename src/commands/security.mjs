import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { resolveRepoRoot } from "../kernel/paths.mjs";
import { inspectSecurityPolicy } from "../kernel/security-policy.mjs";

export async function runSecurity({ args, flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const action = args[0] ?? "check";

  if (!(await isInitialized(repoRoot))) {
    return createErrorResult({
      command: "security",
      cwd: repoRoot,
      code: "NOT_INITIALIZED",
      message: "当前仓库尚未初始化，请先运行 `specnfc init`",
      next: ["运行 `specnfc init --profile standard`"]
    });
  }

  if (action !== "check") {
    return createErrorResult({
      command: "security",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: `未识别的 security 子命令：${action}`,
      next: ["支持的子命令：check"]
    });
  }

  const report = await inspectSecurityPolicy({ repoRoot });
  const blockingCount = report.issues.filter((issue) => issue.severity === "blocking").length;

  return {
    ...createSuccessResult({
      command: "security",
      cwd: repoRoot,
      data: report,
      human: {
        summary:
          report.status === "valid"
            ? "权限清单有效。"
            : report.status === "missing"
              ? "缺少权限清单。"
              : `权限清单存在 ${report.issues.length} 个问题。`,
        sections: [
          {
            title: "摘要",
            items: [
              `状态：${report.status}`,
              `默认策略：${report.defaultPolicy ?? "未知"}`,
              `写范围：${report.summary?.writeScopes ?? 0}`,
              `受保护路径：${report.summary?.protectedScopes ?? 0}`,
              `网络出口：${report.summary?.networkEgress ?? "未知"}`,
              `需审批：${report.summary?.requiresApproval ? "是" : "否"}`
            ]
          },
          {
            title: "问题",
            items: report.issues.length
              ? report.issues.map((issue) => `[${issue.severity}] ${issue.code}：${issue.message}`)
              : ["无"]
          }
        ]
      },
      next: blockingCount
        ? ["收敛权限清单后重新运行 `specnfc security check`"]
        : ["运行 `specnfc ci` 做完整门禁"]
    }),
    exitCode: blockingCount ? 1 : 0
  };
}