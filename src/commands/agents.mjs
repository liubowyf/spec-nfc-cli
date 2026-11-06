import path from "node:path";
import { randomUUID } from "node:crypto";
import { createErrorResult, createSuccessResult } from "../cli/output.mjs";
import { isInitialized } from "../kernel/config.mjs";
import { getRepoPaths, resolveRepoRoot } from "../kernel/paths.mjs";
import {
  AGENT_ROLES_CATALOG,
  AGENT_TASK_TEMPLATE,
  buildDelegationTaskTemplate,
  exportAgentRoles,
  inspectAgentRoles
} from "../kernel/agent-roles.mjs";
import { assertPathInsideRoot, ensureDir, pathExists, readJson, writeJson } from "../utils/fs.mjs";
import { normalizeChangeId } from "../workflow/changes.mjs";

export async function runAgents({ args, flags, runtime }) {
  const repoRoot = resolveRepoRoot(flags.cwd, runtime.cwd);
  const action = args[0] ?? "list";

  if (!(await isInitialized(repoRoot))) {
    return createErrorResult({
      command: "agents",
      cwd: repoRoot,
      code: "NOT_INITIALIZED",
      message: "当前仓库尚未初始化，请先运行 `specnfc init`",
      next: ["运行 `specnfc init --profile standard`"]
    });
  }

  if (action === "list" || action === "validate") {
    const report = await inspectAgentRoles({ repoRoot });
    const invalid = report.status === "invalid";

    return {
      ...createSuccessResult({
        command: "agents",
        cwd: repoRoot,
        data: report,
        human: {
          summary:
            action === "validate"
              ? report.status === "valid"
                ? `全部 ${report.roleCount} 个角色定义有效。`
                : `角色定义存在 ${report.issues.length} 个问题。`
              : `当前定义 ${report.roleCount} 个 agent 角色。`,
          sections: [
            {
              title: "角色",
              items: report.roles?.length
                ? report.roles.map(
                    (role) =>
                      `${role.name}｜阶段 ${role.phases.join("/")}｜写权限 ${role.canWrite ? "是" : "否"}｜隔离 ${role.isolation ?? "无"}`
                  )
                : ["当前无角色定义"]
            },
            {
              title: "阶段覆盖",
              items: Object.entries(report.coverage ?? {}).map(
                ([phase, roles]) => `${phase}：${roles.length ? roles.join("、") : "缺失"}`
              )
            },
            {
              title: "问题",
              items: report.issues?.length
                ? report.issues.map((issue) => `[${issue.severity}] ${issue.code}：${issue.message}`)
                : ["无"]
            }
          ]
        },
        next: invalid
          ? ["修复 `.specnfc/agents/roles.json` 后重新运行 `specnfc agents validate`"]
          : ["运行 `specnfc agents export --to .claude/agents` 导出为子代理定义"]
      }),
      exitCode: action === "validate" && invalid ? 1 : 0
    };
  }

  if (action === "export") {
    const targetRoot = flags.to ? String(flags.to) : ".claude/agents";
    try {
      const result = await exportAgentRoles({
        repoRoot,
        targetRoot,
        force: Boolean(flags.force)
      });
      return createSuccessResult({
        command: "agents",
        cwd: repoRoot,
        data: result,
        human: {
          summary: `已导出 ${result.exported.length} 个角色到 ${result.targetRoot}`,
          sections: [
            { title: "已导出", items: result.exported.length ? result.exported : ["无"] },
            ...(result.skipped.length ? [{ title: "已跳过（已存在）", items: result.skipped }] : [])
          ]
        },
        next: ["在支持 subagent 定义的代理中加载导出目录"]
      });
    } catch (error) {
      return createErrorResult({
        command: "agents",
        cwd: repoRoot,
        code: "WRITE_DENIED",
        message: error instanceof Error ? error.message : "导出失败",
        next: ["确认 `--to` 指向仓库内目录"]
      });
    }
  }

  if (action === "task") {
    return runCreateTask({ repoRoot, args, flags });
  }

  return createErrorResult({
    command: "agents",
    cwd: repoRoot,
    code: "INVALID_ARGS",
    message: `未识别的 agents 子命令：${action}`,
    next: ["支持的子命令：list、validate、export、task"]
  });
}

async function runCreateTask({ repoRoot, args, flags }) {
  const roleName = args[1];
  const changeId = normalizeChangeId(flags.change);

  if (!roleName || !changeId) {
    return createErrorResult({
      command: "agents",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: "缺少角色名或 --change",
      next: ["示例：`specnfc agents task executor --change risk-device-link --goal \"补齐回归测试\"`"]
    });
  }

  const catalogPath = path.join(repoRoot, AGENT_ROLES_CATALOG);
  if (!(await pathExists(catalogPath))) {
    return createErrorResult({
      command: "agents",
      cwd: repoRoot,
      code: "DRIFT_DETECTED",
      message: "缺少角色目录，请先运行 `specnfc upgrade` 或重新初始化",
      next: ["运行 `specnfc upgrade`"]
    });
  }

  let catalog;
  try {
    catalog = await readJson(catalogPath);
  } catch {
    return createErrorResult({
      command: "agents",
      cwd: repoRoot,
      code: "INVALID_CONFIG",
      message: "角色目录无法解析",
      next: ["运行 `specnfc doctor` 查看问题"]
    });
  }

  const role = (catalog.roles ?? []).find((item) => item.name === roleName);
  if (!role) {
    return createErrorResult({
      command: "agents",
      cwd: repoRoot,
      code: "INVALID_ARGS",
      message: `未找到角色：${roleName}`,
      next: ["运行 `specnfc agents list` 查看可用角色"]
    });
  }

  const templatePath = path.join(repoRoot, AGENT_TASK_TEMPLATE);
  const template = (await pathExists(templatePath))
    ? await readJson(templatePath)
    : buildDelegationTaskTemplate();

  const taskId = `task-${changeId}-${roleName}`;
  const task = {
    ...template,
    taskId,
    traceId: `trace-${randomUUID()}`,
    parentTraceId: null,
    role: roleName,
    changeId,
    goal: flags.goal ? String(flags.goal) : template.goal,
    isolation: {
      ...template.isolation,
      mode: role.isolation === "none" ? "none" : role.isolation
    },
    handoff: {
      ...template.handoff,
      to: Array.isArray(role.handoffTo) && role.handoffTo.length ? role.handoffTo[0] : template.handoff.to
    },
    createdAt: new Date().toISOString()
  };

  const repoPaths = getRepoPaths(repoRoot);
  const targetPath = path.join(repoPaths.nfcRoot, "tasks", `${taskId}.json`);
  await assertPathInsideRoot(repoRoot, targetPath);
  await ensureDir(path.dirname(targetPath));
  await writeJson(targetPath, task);

  return createSuccessResult({
    command: "agents",
    cwd: repoRoot,
    data: {
      taskId,
      role: roleName,
      changeId,
      path: path.relative(repoRoot, targetPath).split(path.sep).join("/"),
      task
    },
    human: {
      summary: `已创建委派任务 ${taskId}`,
      sections: [
        { title: "任务契约", items: [`角色：${roleName}`, `change：${changeId}`, `目标：${task.goal}`, `隔离：${task.isolation.mode}`] }
      ]
    },
    next: ["把任务契约交给对应子代理", "完成后运行 `specnfc trace <change-id>` 核对证据链"]
  });
}