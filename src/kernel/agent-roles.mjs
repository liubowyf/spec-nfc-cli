import path from "node:path";
import { assertPathInsideRoot, ensureDir, isFile, listDir, pathExists, readText, writeText } from "../utils/fs.mjs";

export const AGENT_ROLES_ROOT = ".specnfc/agents";
export const AGENT_ROLES_CATALOG = ".specnfc/agents/roles.json";
export const AGENT_ROLE_DOCS_ROOT = ".specnfc/agents/roles";
export const AGENT_TASK_TEMPLATE = ".specnfc/agents/task-template.json";
export const AGENT_ROLE_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const ROLE_PHASES = ["clarify", "design", "plan", "execute", "verify", "accept", "archive"];

const DEFAULT_ROLES = [
  {
    name: "orchestrator",
    label: "编排者",
    description: "拆解任务、选择角色、控制并行与停止条件；不直接修改代码。",
    phases: ["clarify", "design", "plan", "execute", "verify", "accept", "archive"],
    tools: ["Read", "Grep", "Glob", "Agent"],
    canWrite: false,
    writeScopes: [],
    isolation: "none",
    delegates: true,
    handoffTo: ["planner", "executor", "reviewer", "verifier", "release-manager"],
    stopConditions: [
      "当前 change 未绑定或阶段 gate 未通过",
      "需要破坏性操作或发布动作",
      "子代理输出缺少证据或验收映射"
    ]
  },
  {
    name: "planner",
    label: "规划者",
    description: "负责需求澄清、方案设计与任务拆解，只写正式 dossier。",
    phases: ["clarify", "design", "plan"],
    tools: ["Read", "Grep", "Glob", "Write"],
    canWrite: true,
    writeScopes: ["specs/changes/**", ".nfc/interviews/**", ".nfc/plans/**"],
    isolation: "shared",
    delegates: false,
    handoffTo: ["executor"],
    stopConditions: [
      "需求当前选择未确认",
      "缺少验收口径或非目标",
      "需要修改实现代码"
    ]
  },
  {
    name: "executor",
    label: "执行者",
    description: "按已批准的 plan 实施最小正确改动，并持续回填状态。",
    phases: ["plan", "execute"],
    tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
    canWrite: true,
    writeScopes: ["src/**", "tests/**", "specs/changes/**", ".nfc/**"],
    isolation: "worktree",
    delegates: false,
    handoffTo: ["reviewer", "verifier"],
    stopConditions: [
      "plan 或 tasks 未形成",
      "需要绕过测试或验证",
      "涉及权限、支付、数据迁移等高风险边界且未获审批"
    ]
  },
  {
    name: "debugger",
    label: "调试者",
    description: "先复现、后定位、再修复，保留失败与修复证据。",
    phases: ["execute", "verify"],
    tools: ["Read", "Grep", "Glob", "Edit", "Bash"],
    canWrite: true,
    writeScopes: ["src/**", "tests/**", "specs/changes/**", ".nfc/logs/**"],
    isolation: "worktree",
    delegates: false,
    handoffTo: ["executor", "verifier"],
    stopConditions: [
      "没有稳定复现证据",
      "根因与现象未区分",
      "修复后缺少回归验证"
    ]
  },
  {
    name: "reviewer",
    label: "评审者",
    description: "对设计、实现与契约形成结构化 review 结论，只写证据记录。",
    phases: ["verify"],
    tools: ["Read", "Grep", "Glob", "Write"],
    canWrite: true,
    writeScopes: ["specs/changes/**/evidence/reviews/**", "specs/integrations/**/evidence/reviews/**"],
    isolation: "shared",
    delegates: false,
    handoffTo: ["verifier"],
    stopConditions: [
      "评审对象或范围不明确",
      "缺少验证摘要或风险说明"
    ]
  },
  {
    name: "verifier",
    label: "验证者",
    description: "运行验证命令、核对证据与验收标准，形成 verification-record。",
    phases: ["verify", "accept"],
    tools: ["Read", "Grep", "Glob", "Bash", "Write"],
    canWrite: true,
    writeScopes: ["specs/changes/**/evidence/verifications/**", "specs/changes/**/acceptance.md"],
    isolation: "shared",
    delegates: false,
    handoffTo: ["release-manager"],
    stopConditions: [
      "验证命令无法运行或结果不 fresh",
      "验收标准缺少证据映射",
      "存在未解释的失败项"
    ]
  },
  {
    name: "release-manager",
    label: "发布交接者",
    description: "整理发布影响、回退方案与交接单；发布动作必须人工审批。",
    phases: ["accept", "archive"],
    tools: ["Read", "Grep", "Glob", "Bash", "Write"],
    canWrite: true,
    writeScopes: ["specs/changes/**/release-handoff.md", "specs/changes/**/delivery-checklist.md", ".specnfc/governance/release-decisions/**"],
    isolation: "none",
    delegates: false,
    handoffTo: [],
    stopConditions: [
      "缺少 approval-record 或 verification-record",
      "回退方案或发布影响不完整",
      "未经人工确认执行发布"
    ],
    requiresApproval: true
  }
];

export function getDefaultAgentRoles() {
  return structuredClone(DEFAULT_ROLES);
}

export function buildAgentRoleCatalog({ version = "0.0.0" } = {}) {
  return {
    version,
    namespace: "specnfc.official",
    canonicalPhases: [...ROLE_PHASES],
    generatedAt: new Date().toISOString(),
    roles: getDefaultAgentRoles().map((role) => ({
      ...role,
      handoffContract: {
        input: "specs/changes/<change-id>/meta.json",
        output: "structured result with evidence refs and next-stage recommendation",
        traceContext: "w3c-traceparent"
      }
    }))
  };
}

export function buildDelegationTaskTemplate() {
  return {
    taskId: "task-<id>",
    traceId: "trace-<id>",
    parentTraceId: "trace-<parent-id>",
    role: "executor",
    changeId: "<change-id>",
    goal: "用一句话描述可验收的子任务目标",
    inputs: {
      documents: ["specs/changes/<change-id>/01-需求与方案.md"],
      codeRefs: [],
      evidenceRefs: []
    },
    constraints: {
      allowedPaths: ["src/**", "tests/**"],
      forbiddenPaths: [".git/**", "**/.env", "**/secrets/**"],
      maxChangedFiles: 20
    },
    acceptance: [
      {
        id: "AC-001",
        criterion: "子任务验收标准，必须可验证"
      }
    ],
    budget: {
      maxToolCalls: 60,
      maxMinutes: 30,
      maxChangedLines: 800
    },
    isolation: {
      mode: "worktree",
      branch: "agent/<change-id>/<task-id>"
    },
    stopConditions: [
      "需要破坏性操作",
      "需要发布或访问凭据",
      "验收标准无法满足"
    ],
    handoff: {
      to: "reviewer",
      artifact: "structured result json"
    }
  };
}

export function renderAgentRoleDocument(role) {
  const lines = [
    "---",
    `name: ${role.name}`,
    `description: ${JSON.stringify(role.description)}`,
    `tools: ${role.tools.join(", ")}`,
    "model: inherit",
    "---",
    "",
    `# ${role.label}（${role.name}）`,
    "",
    `- 适用阶段：${role.phases.map((phase) => `\`${phase}\``).join("、")}`,
    `- 写权限：${role.canWrite ? "允许（受限）" : "禁止"}`,
    `- 隔离方式：\`${role.isolation}\``,
    `- 可委派：${role.delegates ? "是" : "否"}`,
    `- 下游交接：${role.handoffTo.length ? role.handoffTo.map((item) => `\`${item}\``).join("、") : "无"}`,
    role.requiresApproval ? "- 发布/破坏性动作：必须人工审批" : "",
    "",
    "## 写权限边界",
    ...(role.writeScopes.length ? role.writeScopes.map((scope) => `- \`${scope}\``) : ["- 无"]),
    "",
    "## 停止条件",
    ...role.stopConditions.map((condition) => `- ${condition}`),
    "",
    "## 交接要求",
    "- 只返回最终结果、证据引用与下一步建议，不传递长篇推理过程。",
    "- 所有正式结论必须写回 `specs/` 或 `.specnfc/` 下的受管文件。",
    "- 交接时携带 `traceId`，便于跨代理追踪。",
    ""
  ];
  return lines.filter((line, index, all) => !(line === "" && all[index - 1] === "")).join("\n");
}

export async function inspectAgentRoles({ repoRoot }) {
  const catalogPath = path.join(repoRoot, AGENT_ROLES_CATALOG);
  const issues = [];

  if (!(await pathExists(catalogPath))) {
    return {
      status: "missing",
      path: AGENT_ROLES_CATALOG,
      roleCount: 0,
      issues: [
        {
          severity: "advisory",
          code: "AGENT_ROLES_MISSING",
          message: "缺少 agent 角色目录；无法约束多代理分工与交接"
        }
      ],
      coverage: {}
    };
  }

  let catalog;
  try {
    catalog = JSON.parse(await readText(catalogPath));
  } catch (error) {
    return {
      status: "invalid",
      path: AGENT_ROLES_CATALOG,
      roleCount: 0,
      issues: [
        {
          severity: "blocking",
          code: "AGENT_ROLES_INVALID",
          message: `角色目录无法解析：${error instanceof Error ? error.message : String(error)}`
        }
      ],
      coverage: {}
    };
  }

  const roles = Array.isArray(catalog?.roles) ? catalog.roles : [];
  const names = new Set(roles.map((role) => String(role?.name ?? "").trim()).filter(Boolean));
  const seenNames = new Set();

  for (const [index, role] of roles.entries()) {
    const label = `roles[${index}]`;
    const name = String(role?.name ?? "").trim();

    if (!name || !AGENT_ROLE_NAME_PATTERN.test(name)) {
      issues.push({ severity: "blocking", code: "AGENT_ROLE_NAME_INVALID", message: `${label} 的 name 非法：${name || "空"}` });
    } else if (seenNames.has(name)) {
      issues.push({ severity: "blocking", code: "AGENT_ROLE_DUPLICATE", message: `角色名称重复：${name}` });
    } else {
      seenNames.add(name);
    }

    if (!Array.isArray(role?.phases) || role.phases.length === 0) {
      issues.push({ severity: "blocking", code: "AGENT_ROLE_PHASE_MISSING", message: `${name || label} 未声明 phases` });
    } else {
      for (const phase of role.phases) {
        if (!ROLE_PHASES.includes(phase)) {
          issues.push({ severity: "blocking", code: "AGENT_ROLE_PHASE_INVALID", message: `${name || label} 声明了非法阶段：${phase}` });
        }
      }
    }

    const tools = Array.isArray(role?.tools) ? role.tools : [];
    if (!tools.length) {
      issues.push({ severity: "advisory", code: "AGENT_ROLE_TOOLS_EMPTY", message: `${name || label} 未声明 tools` });
    }
    if (tools.some((tool) => tool === "*" || String(tool).includes("(*)"))) {
      issues.push({ severity: "blocking", code: "AGENT_ROLE_TOOLS_WILDCARD", message: `${name || label} 使用通配符工具，违反最小权限原则` });
    }

    if (role?.canWrite) {
      const scopes = Array.isArray(role?.writeScopes) ? role.writeScopes : [];
      if (!scopes.length) {
        issues.push({ severity: "blocking", code: "AGENT_ROLE_WRITE_SCOPE_MISSING", message: `${name || label} 可写但未声明 writeScopes` });
      }
      if (scopes.some((scope) => scope === "**" || scope === "**/*" || scope === ".")) {
        issues.push({ severity: "blocking", code: "AGENT_ROLE_WRITE_TOO_BROAD", message: `${name || label} 的写范围覆盖整个仓库` });
      }
      if (!Array.isArray(role?.stopConditions) || role.stopConditions.length === 0) {
        issues.push({ severity: "advisory", code: "AGENT_ROLE_STOP_CONDITIONS_MISSING", message: `${name || label} 可写但未声明 stopConditions` });
      }
    }

    if (Array.isArray(role?.handoffTo)) {
      for (const target of role.handoffTo) {
        if (!names.has(target)) {
          issues.push({ severity: "advisory", code: "AGENT_ROLE_HANDOFF_UNRESOLVED", message: `${name || label} 的 handoffTo 指向未知角色：${target}` });
        }
      }
    }
  }

  if (!names.has("orchestrator")) {
    issues.push({ severity: "advisory", code: "AGENT_ROLE_ORCHESTRATOR_MISSING", message: "建议提供 orchestrator 角色负责拆解与编排" });
  }

  const coverage = {};
  for (const phase of ROLE_PHASES) {
    const matched = roles.filter((role) => Array.isArray(role.phases) && role.phases.includes(phase)).map((role) => role.name);
    coverage[phase] = matched;
    if (!matched.length) {
      issues.push({ severity: "advisory", code: "AGENT_ROLE_PHASE_GAP", message: `阶段 ${phase} 没有对应角色` });
    }
  }

  const blockingCount = issues.filter((issue) => issue.severity === "blocking").length;

  return {
    status: blockingCount ? "invalid" : issues.length ? "partial" : "valid",
    path: AGENT_ROLES_CATALOG,
    roleCount: roles.length,
    roles: roles.map((role) => ({
      name: role.name,
      phases: role.phases,
      canWrite: Boolean(role.canWrite),
      isolation: role.isolation ?? null,
      tools: role.tools ?? []
    })),
    coverage,
    issues
  };
}

export async function exportAgentRoles({ repoRoot, targetRoot = ".claude/agents", force = false }) {
  const rolesRoot = path.join(repoRoot, AGENT_ROLE_DOCS_ROOT);
  const destinationRoot = path.resolve(repoRoot, targetRoot);
  const repoRootResolved = path.resolve(repoRoot);

  if (destinationRoot === repoRootResolved) {
    throw new Error("WRITE_DENIED: 不允许导出到仓库根目录");
  }
  await assertPathInsideRoot(repoRoot, destinationRoot);
  if (!(await pathExists(rolesRoot))) {
    return { targetRoot: toRelative(repoRoot, destinationRoot), exported: [], skipped: [], conflicts: [] };
  }

  const exported = [];
  const skipped = [];
  const conflicts = [];

  for (const entry of (await listDir(rolesRoot)).sort()) {
    if (!entry.endsWith(".md")) {
      continue;
    }
    const sourcePath = path.join(rolesRoot, entry);
    if (!(await isFile(sourcePath))) {
      continue;
    }
    const destinationPath = path.join(destinationRoot, entry);
    if ((await pathExists(destinationPath)) && !force) {
      skipped.push(toRelative(repoRoot, destinationPath));
      continue;
    }
    await ensureDir(destinationRoot);
    await writeText(destinationPath, await readText(sourcePath));
    exported.push(toRelative(repoRoot, destinationPath));
  }

  return { targetRoot: toRelative(repoRoot, destinationRoot), exported, skipped, conflicts };
}

export function buildAgentRoleArtifacts({ version = "0.0.0" } = {}) {
  const catalog = buildAgentRoleCatalog({ version });
  return [
    {
      target: AGENT_ROLES_CATALOG,
      format: "json",
      content: catalog
    },
    {
      target: AGENT_TASK_TEMPLATE,
      format: "json",
      content: buildDelegationTaskTemplate()
    },
    ...catalog.roles.map((role) => ({
      target: `${AGENT_ROLE_DOCS_ROOT}/${role.name}.md`,
      format: "text",
      content: renderAgentRoleDocument(role)
    }))
  ];
}

function toRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}