import path from "node:path";
import { isDirectory, listDir, pathExists, readText } from "../utils/fs.mjs";

export const AGENTS_STANDARD_MAX_LINES = 200;
export const AGENTS_STANDARD_HARD_LIMIT = 400;
export const AGENTS_REQUIRED_SECTIONS = [
  "## 项目概览",
  "## 安装与验证命令",
  "## 代码与文档规范",
  "## 安全边界",
  "## Skills 与工具"
];

export const AGENTS_REQUIRED_REFERENCES = [
  ".specnfc/",
  "SKILL.md",
  ".specnfc/mcp/policy.json",
  ".specnfc/security/permissions.json"
];

export async function inspectAgentInstructions({ repoRoot }) {
  const agentsPath = path.join(repoRoot, "AGENTS.md");
  const issues = [];

  if (!(await pathExists(agentsPath))) {
    return {
      status: "missing",
      path: "AGENTS.md",
      lineCount: 0,
      issues: [
        {
          severity: "blocking",
          code: "AGENTS_MISSING",
          message: "缺少 AGENTS.md；多数编码代理无法获得仓库级指令"
        }
      ],
      nested: []
    };
  }

  const content = await readText(agentsPath);
  const lineCount = content.split(/\r?\n/).length;
  const missingSections = AGENTS_REQUIRED_SECTIONS.filter((section) => !content.includes(section));
  const missingReferences = AGENTS_REQUIRED_REFERENCES.filter((reference) => !content.includes(reference));

  if (lineCount > AGENTS_STANDARD_HARD_LIMIT) {
    issues.push({
      severity: "blocking",
      code: "AGENTS_TOO_LONG",
      message: `AGENTS.md 共 ${lineCount} 行，超过 ${AGENTS_STANDARD_HARD_LIMIT} 行硬上限；请下沉到子目录或引用文档`
    });
  } else if (lineCount > AGENTS_STANDARD_MAX_LINES) {
    issues.push({
      severity: "advisory",
      code: "AGENTS_LONG",
      message: `AGENTS.md 共 ${lineCount} 行，建议控制在 ${AGENTS_STANDARD_MAX_LINES} 行以内`
    });
  }

  if (missingSections.length) {
    issues.push({
      severity: "advisory",
      code: "AGENTS_SECTIONS_MISSING",
      message: `AGENTS.md 缺少标准 section：${missingSections.join("、")}`
    });
  }

  if (missingReferences.length) {
    issues.push({
      severity: "advisory",
      code: "AGENTS_REFERENCES_MISSING",
      message: `AGENTS.md 未引用：${missingReferences.join("、")}`
    });
  }

  if (!content.includes("最近") || !content.includes("AGENTS.md")) {
    issues.push({
      severity: "advisory",
      code: "AGENTS_NESTING_UNDOCUMENTED",
      message: "建议说明嵌套 AGENTS.md 的就近优先规则"
    });
  }

  const nested = await discoverNestedAgents({ repoRoot });
  if (nested.length) {
    issues.push({
      severity: "advisory",
      code: "AGENTS_NESTED_FILES",
      message: `发现 ${nested.length} 个嵌套 AGENTS.md：${nested.join("、")}`
    });
  }

  const blockingCount = issues.filter((issue) => issue.severity === "blocking").length;

  return {
    status: blockingCount ? "invalid" : issues.length ? "partial" : "valid",
    path: "AGENTS.md",
    lineCount,
    missingSections,
    missingReferences,
    nested,
    issues
  };
}

async function discoverNestedAgents({ repoRoot, maxDepth = 3 }) {
  const results = [];

  async function visit(directory, depth) {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = await listDir(directory);
    } catch {
      return;
    }
    for (const entry of entries.sort()) {
      if (
        entry.startsWith(".") ||
        entry === "node_modules" ||
        entry === "specs" ||
        entry === "dist" ||
        entry === "coverage"
      ) {
        continue;
      }
      const absolutePath = path.join(directory, entry);
      if (!(await isDirectory(absolutePath))) {
        continue;
      }
      const nestedPath = path.join(absolutePath, "AGENTS.md");
      if (await pathExists(nestedPath)) {
        results.push(path.relative(repoRoot, nestedPath).split(path.sep).join("/"));
      }
      await visit(absolutePath, depth + 1);
    }
  }

  await visit(repoRoot, 1);
  return results;
}