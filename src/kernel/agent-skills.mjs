import path from "node:path";
import { cp } from "node:fs/promises";
import {
  getBuiltInGovernanceSkillDefinitions,
  getBuiltInSupportSkillDefinitions,
  getBuiltInWorkflowSkillDefinitions,
  readBuiltInSkillPackSourceText
} from "./skill-pack-source.mjs";
import { assertPathInsideRoot, ensureDir, isDirectory, listDir, pathExists, readText } from "../utils/fs.mjs";

export const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SKILL_MAX_NAME_LENGTH = 64;
export const SKILL_MAX_DESCRIPTION_LENGTH = 1024;
export const SKILL_MAX_COMPATIBILITY_LENGTH = 500;
export const SKILL_RECOMMENDED_MAX_LINES = 500;
export const SKILLS_ACTIVE_ROOT = ".specnfc/skill-packs/active/skills";

export function getActiveSkillsRoot(repoRoot) {
  return path.join(repoRoot, SKILLS_ACTIVE_ROOT);
}

export function parseSkillFrontmatter(content) {
  const text = String(content ?? "");
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);

  if (!match) {
    return { hasFrontmatter: false, data: {}, body: text };
  }

  const data = {};
  let currentMap = null;

  for (const rawLine of match[1].split(/\r?\n/)) {
    if (!rawLine.trim() || rawLine.trim().startsWith("#")) {
      continue;
    }

    const indented = /^\s+/.test(rawLine);
    const line = rawLine.trim();
    const separator = line.indexOf(":");
    if (separator <= 0) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const rawValue = line.slice(separator + 1).trim();

    if (!indented && rawValue === "") {
      currentMap = {};
      data[key] = currentMap;
      continue;
    }

    if (indented && currentMap) {
      currentMap[key] = unquote(rawValue);
      continue;
    }

    currentMap = null;
    data[key] = unquote(rawValue);
  }

  return {
    hasFrontmatter: true,
    data,
    body: text.slice(match[0].length)
  };
}

function unquote(value) {
  const trimmed = String(value ?? "").trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function validateSkillDocument({ dirName, content }) {
  const errors = [];
  const warnings = [];
  const parsed = parseSkillFrontmatter(content);

  if (!parsed.hasFrontmatter) {
    errors.push("缺少 YAML frontmatter");
    return { valid: false, errors, warnings, meta: {} };
  }

  const name = String(parsed.data.name ?? "").trim();
  const description = String(parsed.data.description ?? "").trim();
  const license = String(parsed.data.license ?? "").trim();
  const compatibility = String(parsed.data.compatibility ?? "").trim();
  const allowedTools = String(parsed.data["allowed-tools"] ?? "").trim();
  const metadata = parsed.data.metadata;

  if (!name) {
    errors.push("缺少必填字段 name");
  } else {
    if (name.length > SKILL_MAX_NAME_LENGTH) {
      errors.push(`name 超过 ${SKILL_MAX_NAME_LENGTH} 字符`);
    }
    if (!SKILL_NAME_PATTERN.test(name)) {
      errors.push("name 仅允许小写字母、数字和单连字符，且不能以连字符开头或结尾");
    }
    if (dirName && name !== dirName) {
      errors.push(`name 必须与目录名一致：期望 ${dirName}，实际 ${name}`);
    }
  }

  if (!description) {
    errors.push("缺少必填字段 description");
  } else if (description.length > SKILL_MAX_DESCRIPTION_LENGTH) {
    errors.push(`description 超过 ${SKILL_MAX_DESCRIPTION_LENGTH} 字符`);
  } else if (description.length < 20) {
    warnings.push("description 过短，建议说明技能做什么以及何时使用");
  }

  if (compatibility.length > SKILL_MAX_COMPATIBILITY_LENGTH) {
    errors.push(`compatibility 超过 ${SKILL_MAX_COMPATIBILITY_LENGTH} 字符`);
  }

  if (allowedTools && /,\s/.test(allowedTools)) {
    warnings.push("allowed-tools 建议使用空格分隔");
  }

  if (metadata !== undefined && (typeof metadata !== "object" || Array.isArray(metadata))) {
    errors.push("metadata 必须是字符串键值映射");
  }

  const bodyLines = parsed.body.trim().split(/\r?\n/).length;
  if (bodyLines > SKILL_RECOMMENDED_MAX_LINES) {
    warnings.push(`SKILL.md 正文 ${bodyLines} 行，建议少于 ${SKILL_RECOMMENDED_MAX_LINES} 行并拆分 references/`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    meta: {
      name,
      description,
      license,
      compatibility,
      allowedTools,
      metadata: metadata ?? {},
      bodyLines
    }
  };
}

export function buildSkillMarkdown({
  name,
  description,
  body,
  license,
  compatibility,
  allowedTools,
  metadata = {}
}) {
  const lines = ["---", `name: ${name}`, `description: ${toYamlString(description)}`];

  if (license) {
    lines.push(`license: ${toYamlString(license)}`);
  }
  if (compatibility) {
    lines.push(`compatibility: ${toYamlString(compatibility)}`);
  }
  if (allowedTools) {
    lines.push(`allowed-tools: ${toYamlString(allowedTools)}`);
  }

  const metadataEntries = Object.entries(metadata).filter(([, value]) => value !== undefined && value !== null);
  if (metadataEntries.length) {
    lines.push("metadata:");
    for (const [key, value] of metadataEntries) {
      lines.push(`  ${key}: ${toYamlString(String(value))}`);
    }
  }

  lines.push("---", "", String(body ?? "").trim(), "");
  return lines.join("\n");
}

function toYamlString(value) {
  const text = String(value ?? "").replace(/\r?\n/g, " ").trim();
  if (/^[A-Za-z0-9_./: -]+$/.test(text) && !text.includes(": ")) {
    return text;
  }
  return JSON.stringify(text);
}

export function getAgentSkillDefinitions() {
  const workflow = getBuiltInWorkflowSkillDefinitions().map((skill) => ({
    layer: "workflow",
    slug: skill.slug,
    name: skill.name,
    phase: skill.phase,
    description: `${skill.name}：${skill.trigger}`,
    sourcePath: skill.sourcePath
  }));

  const support = getBuiltInSupportSkillDefinitions().map((skill) => ({
    layer: "support",
    slug: skill.slug,
    name: skill.name,
    category: skill.category,
    description: `${skill.name}：${skill.purpose}`,
    sourcePath: skill.sourcePath
  }));

  const governance = getBuiltInGovernanceSkillDefinitions().map((skill) => ({
    layer: "governance",
    slug: skill.slug,
    name: skill.name,
    description: `${skill.name}：${skill.trigger}`,
    sourcePath: skill.sourcePath ?? `governance/${skill.slug}.md`
  }));

  return [...workflow, ...support, ...governance];
}

export function buildAgentSkillArtifacts({ version = null } = {}) {
  const packageVersion = version ?? "0.0.0";
  return getAgentSkillDefinitions().map((definition) => {
    const source = readSkillSource(definition);
    const parsed = parseSkillFrontmatter(source);
    const metadata = {
      "specnfc.layer": definition.layer,
      "specnfc.namespace": "specnfc.official",
      "specnfc.version": packageVersion,
      "specnfc.trust-tier": "governed"
    };
    if (definition.phase) {
      metadata["specnfc.phase"] = definition.phase;
    }
    if (definition.category) {
      metadata["specnfc.category"] = definition.category;
    }

    return {
      slug: definition.slug,
      layer: definition.layer,
      target: `${SKILLS_ACTIVE_ROOT}/${definition.slug}/SKILL.md`,
      content: buildSkillMarkdown({
        name: definition.slug,
        description: definition.description,
        compatibility: "Designed for Spec nfc governed workflows; compatible with any SKILL.md agent runtime.",
        metadata,
        body: parsed.hasFrontmatter ? parsed.body : source
      })
    };
  });
}

export async function listActiveSkills({ repoRoot }) {
  const root = getActiveSkillsRoot(repoRoot);
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = (await listDir(root)).sort();
  const skills = [];

  for (const entry of entries) {
    const skillDir = path.join(root, entry);
    if (!(await isDirectory(skillDir))) {
      continue;
    }
    const skillPath = path.join(skillDir, "SKILL.md");
    if (!(await pathExists(skillPath))) {
      skills.push({
        slug: entry,
        path: toRelative(repoRoot, skillDir),
        status: "invalid",
        errors: ["缺少 SKILL.md"],
        warnings: []
      });
      continue;
    }

    const content = await readText(skillPath);
    const validation = validateSkillDocument({ dirName: entry, content });
    skills.push({
      slug: entry,
      path: toRelative(repoRoot, skillPath),
      status: validation.valid ? "valid" : "invalid",
      errors: validation.errors,
      warnings: validation.warnings,
      description: validation.meta.description,
      layer: validation.meta.metadata?.["specnfc.layer"] ?? null,
      phase: validation.meta.metadata?.["specnfc.phase"] ?? null
    });
  }

  return skills;
}

export async function validateActiveSkills({ repoRoot }) {
  const skills = await listActiveSkills({ repoRoot });
  const invalid = skills.filter((skill) => skill.status !== "valid");
  const warnings = skills.flatMap((skill) => skill.warnings.map((warning) => `${skill.slug}: ${warning}`));

  return {
    status: !skills.length ? "missing" : invalid.length ? "invalid" : "valid",
    total: skills.length,
    validCount: skills.length - invalid.length,
    invalidCount: invalid.length,
    warningCount: warnings.length,
    skills,
    warnings
  };
}

export async function exportSkills({ repoRoot, targetRoot = "skills", slugs = [], force = false }) {
  const activeRoot = getActiveSkillsRoot(repoRoot);
  const destinationRoot = path.resolve(repoRoot, targetRoot);
  const repoRootResolved = path.resolve(repoRoot);

  if (destinationRoot === repoRootResolved) {
    throw new Error("WRITE_DENIED: 不允许导出到仓库根目录");
  }
  await assertPathInsideRoot(repoRoot, destinationRoot);

  const selected = new Set(slugs.filter(Boolean));
  const skills = await listActiveSkills({ repoRoot });
  const exported = [];
  const skipped = [];
  const conflicts = [];

  for (const skill of skills) {
    if (selected.size && !selected.has(skill.slug)) {
      continue;
    }
    if (skill.status !== "valid") {
      conflicts.push({ slug: skill.slug, reason: "invalid-skill", errors: skill.errors });
      continue;
    }

    const sourceDir = path.join(activeRoot, skill.slug);
    const destinationDir = path.join(destinationRoot, skill.slug);
    const destinationPath = path.join(destinationDir, "SKILL.md");

    if ((await pathExists(destinationDir)) && !force) {
      skipped.push(toRelative(repoRoot, destinationDir));
      continue;
    }

    await ensureDir(destinationDir);
    await cp(sourceDir, destinationDir, { recursive: true, force: true });
    exported.push(toRelative(repoRoot, destinationPath));
  }

  return {
    targetRoot: toRelative(repoRoot, destinationRoot),
    exported,
    skipped,
    conflicts
  };
}

function toRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}

function readSkillSource(definition) {
  if (definition.sourcePath) {
    try {
      return readBuiltInSkillPackSourceText(definition.sourcePath);
    } catch {
      // Fall back to a generated document below.
    }
  }

  return [`# ${definition.name}（${definition.slug}）`, "", definition.description, ""].join("\n");
}