import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { resolveRepoRoot } from "../kernel/paths.mjs";
import {
  exportSkills,
  listActiveSkills,
  validateActiveSkills
} from "../kernel/agent-skills.mjs";

export async function runSkills({ args, flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const action = args[0] ?? "list";

  if (!(await isInitialized(repoRoot))) {
    return createErrorResult({
      command: "skills",
      cwd: repoRoot,
      code: "NOT_INITIALIZED",
      message: "当前仓库尚未初始化，请先运行 `specnfc init`",
      next: ["运行 `specnfc init --profile standard`"]
    });
  }

  if (action === "list") {
    const skills = await listActiveSkills({ repoRoot });
    const layer = flags.layer ? String(flags.layer) : null;
    const filtered = layer ? skills.filter((skill) => skill.layer === layer) : skills;

    return createSuccessResult({
      command: "skills",
      cwd: repoRoot,
      data: {
        total: filtered.length,
        validCount: filtered.filter((skill) => skill.status === "valid").length,
        invalidCount: filtered.filter((skill) => skill.status !== "valid").length,
        layer,
        skills: filtered
      },
      human: {
        summary: `当前 active skills：${filtered.length} 个`,
        sections: [
          {
            title: "Skills",
            items: filtered.length
              ? filtered.map((skill) => `${skill.slug}｜${skill.layer ?? "unknown"}｜${skill.status}｜${skill.description ?? ""}`)
              : ["当前无 active skill"]
          }
        ]
      },
      next: ["运行 `specnfc skills validate` 校验 Agent Skills 标准", "运行 `specnfc skills export --to skills` 导出为可移植 skill 目录"]
    });
  }

  if (action === "validate") {
    const validation = await validateActiveSkills({ repoRoot });
    const invalid = validation.skills.filter((skill) => skill.status !== "valid");

    return {
      ...createSuccessResult({
        command: "skills",
        cwd: repoRoot,
        data: validation,
        human: {
          summary: validation.invalidCount
            ? `发现 ${validation.invalidCount} 个不符合 Agent Skills 标准的 skill。`
            : `全部 ${validation.total} 个 skill 符合 Agent Skills 标准。`,
          sections: [
            {
              title: "校验结果",
              items: [
                `总数：${validation.total}`,
                `通过：${validation.validCount}`,
                `失败：${validation.invalidCount}`,
                `提示：${validation.warningCount}`
              ]
            },
            {
              title: "问题明细",
              items: invalid.length
                ? invalid.map((skill) => `${skill.slug}：${skill.errors.join("；") || "未知问题"}`)
                : ["无"]
            },
            ...(validation.warnings.length
              ? [{ title: "提示", items: validation.warnings }]
              : [])
          ]
        },
        next: validation.invalidCount
          ? ["修复 SKILL.md frontmatter 后重新运行 `specnfc skills validate`"]
          : ["运行 `specnfc skills export --to skills` 导出"]
      }),
      exitCode: validation.invalidCount ? 1 : 0
    };
  }

  if (action === "export") {
    const targetRoot = flags.to ? String(flags.to) : "skills";
    const slugs = String(flags.only ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    try {
      const result = await exportSkills({
        repoRoot,
        targetRoot,
        slugs,
        force: Boolean(flags.force)
      });

      return createSuccessResult({
        command: "skills",
        cwd: repoRoot,
        data: result,
        human: {
          summary: `已导出 ${result.exported.length} 个 skill 到 ${result.targetRoot}`,
          sections: [
            { title: "已导出", items: result.exported.length ? result.exported : ["无"] },
            ...(result.skipped.length ? [{ title: "已跳过（已存在）", items: result.skipped }] : []),
            ...(result.conflicts.length
              ? [{ title: "冲突", items: result.conflicts.map((item) => `${item.slug}：${item.reason}`) }]
              : [])
          ]
        },
        next: ["在支持 Agent Skills 的代理中加载导出目录", "如目标目录已存在旧文件，使用 `--force` 覆盖"]
      });
    } catch (error) {
      return createErrorResult({
        command: "skills",
        cwd: repoRoot,
        code: "WRITE_DENIED",
        message: error instanceof Error ? error.message : "导出失败",
        next: ["确认 `--to` 指向仓库内目录"]
      });
    }
  }

  return createErrorResult({
    command: "skills",
    cwd: repoRoot,
    code: "INVALID_ARGS",
    message: `未识别的 skills 子命令：${action}`,
    next: ["支持的子命令：list、validate、export"]
  });
}