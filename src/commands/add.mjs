import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { parseModuleList, validateModules } from "../kernel/modules.mjs";
import { resolveRepoRoot } from "../kernel/paths.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { installModules } from "../kernel/scaffold.mjs";

export async function runAdd({ args, flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const rawModules = args.length ? args : parseModuleList(flags.with);

  if (!rawModules.length) {
    return createErrorResult({
      command: "add",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "未提供要安装的模块名",
      next: [
        "支持的模块：context、execution、governance、design-api、design-db、quality、delivery、integration-contract",
        "示例：`specnfc add context,execution`"
      ]
    });
  }

  const requested = parseModuleList(rawModules);
  const validation = validateModules(requested);
  if (!validation.valid) {
    return createErrorResult({
      command: "add",
      cwd: repoRoot,
      code: "MODULE_NOT_FOUND",
      message: `未识别的模块：${validation.invalid.join(", ")}`,
      next: ["运行 `specnfc explain modules` 查看当前支持的模块"]
    });
  }

  if (!(await isInitialized(repoRoot))) {
    return createErrorResult({
      command: "add",
      cwd: repoRoot,
      code: "NOT_INITIALIZED",
      message: "当前仓库尚未初始化，请先运行 `specnfc init`",
      next: ["运行 `specnfc init --with context,execution,governance`"]
    });
  }

  const result = await installModules({
    repoRoot,
    moduleNames: requested,
    dryRun: Boolean(flags.dryRun),
    force: Boolean(flags.force)
  });

  return createSuccessResult({
    command: "add",
    cwd: repoRoot,
    data: {
      addedModules: requested,
      skippedModules: [],
      updatedFiles: result.created,
      dryRun: Boolean(flags.dryRun)
    },
    human: {
      summary: flags.dryRun ? "已生成模块安装预览计划。" : "已完成模块追加。",
      sections: [
        {
          title: "已追加模块",
          items: requested
        },
        {
          title: flags.dryRun ? "计划更新" : "已更新",
          items: result.created
        }
      ]
    },
    warnings: result.warnings,
    next: ["运行 `specnfc doctor`", "运行 `specnfc explain`", "运行 `specnfc change create <change-id>` 创建变更目录"]
  });
}
