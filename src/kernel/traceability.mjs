import path from "node:path";
import { ensureDir, isDirectory, isFile, listDir, pathExists, readText, writeJson } from "../utils/fs.mjs";

export const TRACEABILITY_ROOT = ".specnfc/traceability";
export const TRACE_ID_PATTERNS = {
  requirement: /\bREQ-\d{3,}\b/g,
  acceptance: /\bAC-\d{3,}\b/g,
  task: /\bTASK-\d{3,}\b/g,
  evidence: /\bEV-\d{3,}\b/g
};

const REQUIREMENT_DOC_PATTERN = /(01-需求与方案|spec)\.md$/;
const ACCEPTANCE_DOC_PATTERN = /(04-验收与交接|acceptance|verify|verification)\.md$/;
const PLAN_DOC_PATTERN = /(03-任务计划与执行|plan|tasks)\.md$/;

export async function inspectTraceability({ repoRoot, changeId }) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(String(changeId ?? ""))) {
    return {
      status: "missing",
      changeId,
      changeRoot: null,
      gaps: [{ code: "INVALID_CHANGE_ID", message: `change-id 不合法：${changeId ?? ""}` }],
      counts: emptyCounts(),
      matrix: emptyMatrix()
    };
  }

  const changeRoot = path.join(repoRoot, "specs/changes", changeId);

  if (!(await pathExists(changeRoot))) {
    return {
      status: "missing",
      changeId,
      changeRoot: toRelative(repoRoot, changeRoot),
      gaps: [{ code: "CHANGE_NOT_FOUND", message: `change 不存在：${changeId}` }],
      counts: emptyCounts(),
      matrix: emptyMatrix()
    };
  }

  const documents = await collectDocuments({ repoRoot, changeRoot });
  const occurrences = [];
  const byDocument = [];

  for (const document of documents) {
    const content = await readText(document.absolutePath);
    const ids = extractIds(content);
    const lineIds = content.split(/\r?\n/).map((line, index) => ({
      lineNumber: index + 1,
      line,
      ids: extractIds(line)
    }));

    byDocument.push({
      path: document.relativePath,
      role: document.role,
      ids
    });

    for (const line of lineIds) {
      if (Object.values(line.ids).some((ids) => ids.length)) {
        occurrences.push({
          path: document.relativePath,
          role: document.role,
          lineNumber: line.lineNumber,
          ids: line.ids,
          text: line.line.trim().slice(0, 240)
        });
      }
    }
  }

  const definitions = {
    requirement: new Set(),
    acceptance: new Set(),
    task: new Set(),
    evidence: new Set()
  };

  for (const document of byDocument) {
    for (const [kind, ids] of Object.entries(document.ids)) {
      if (!isDefinitionDocument(document.role, kind)) {
        continue;
      }
      for (const id of ids) {
        definitions[kind].add(id);
      }
    }
  }

  for (const occurrence of occurrences) {
    for (const [kind, ids] of Object.entries(occurrence.ids)) {
      if (!isDefinitionDocument(occurrence.role, kind)) {
        continue;
      }
      for (const id of ids) {
        definitions[kind].add(id);
      }
    }
  }

  const matrix = buildMatrix({ definitions, occurrences });
  const gaps = detectGaps({ definitions, matrix, byDocument, occurrences });
  const counts = {
    requirements: definitions.requirement.size,
    acceptanceCriteria: definitions.acceptance.size,
    tasks: definitions.task.size,
    evidence: definitions.evidence.size,
    documents: documents.length
  };

  const hasIds = Object.values(counts).some((count) => count > 0);

  return {
    status: !hasIds ? "not-adopted" : gaps.length ? "gaps" : "complete",
    changeId,
    changeRoot: toRelative(repoRoot, changeRoot),
    counts,
    matrix,
    gaps,
    documents: byDocument,
    occurrences: occurrences.slice(0, 200)
  };
}

export async function writeTraceabilityReport({ repoRoot, changeId, report }) {
  const targetPath = path.join(repoRoot, TRACEABILITY_ROOT, `${changeId}.json`);
  await ensureDir(path.dirname(targetPath));
  const payload = {
    ...report,
    generatedAt: new Date().toISOString(),
    path: toRelative(repoRoot, targetPath)
  };
  await writeJson(targetPath, payload);
  return payload;
}

async function collectDocuments({ repoRoot, changeRoot }) {
  const documents = [];

  async function visit(directory) {
    for (const entry of (await listDir(directory)).sort()) {
      const absolutePath = path.join(directory, entry);
      if (await isDirectory(absolutePath)) {
        if (entry === "evidence") {
          await collectEvidenceDocuments({ repoRoot, directory: absolutePath, documents });
          continue;
        }
        await visit(absolutePath);
        continue;
      }
      if (!(await isFile(absolutePath)) || !entry.endsWith(".md")) {
        continue;
      }
      documents.push({
        absolutePath,
        relativePath: toRelative(repoRoot, absolutePath),
        role: classifyDocument(entry)
      });
    }
  }

  await visit(changeRoot);
  return documents;
}

async function collectEvidenceDocuments({ repoRoot, directory, documents }) {
  async function visit(current) {
    for (const entry of (await listDir(current)).sort()) {
      const absolutePath = path.join(current, entry);
      if (await isDirectory(absolutePath)) {
        await visit(absolutePath);
        continue;
      }
      if (!(await isFile(absolutePath))) {
        continue;
      }
      documents.push({
        absolutePath,
        relativePath: toRelative(repoRoot, absolutePath),
        role: "evidence"
      });
    }
  }
  await visit(directory);
}

function classifyDocument(fileName) {
  if (REQUIREMENT_DOC_PATTERN.test(fileName)) {
    return "requirements";
  }
  if (ACCEPTANCE_DOC_PATTERN.test(fileName)) {
    return "acceptance";
  }
  if (PLAN_DOC_PATTERN.test(fileName)) {
    return "plan";
  }
  return "other";
}

function isDefinitionDocument(role, kind) {
  if (kind === "requirement") {
    return role === "requirements";
  }
  if (kind === "acceptance") {
    return role === "acceptance" || role === "requirements";
  }
  if (kind === "task") {
    return role === "plan";
  }
  if (kind === "evidence") {
    return role === "acceptance";
  }
  return false;
}

function extractIds(content) {
  const result = {};
  for (const [kind, pattern] of Object.entries(TRACE_ID_PATTERNS)) {
    const matches = String(content ?? "").match(pattern) ?? [];
    result[kind] = Array.from(new Set(matches));
  }
  return result;
}

function buildMatrix({ definitions, occurrences }) {
  const matrix = emptyMatrix();

  for (const id of definitions.requirement) {
    matrix.requirements[id] = { acceptance: [], tasks: [], evidence: [], referencedIn: [] };
  }
  for (const id of definitions.acceptance) {
    matrix.acceptanceCriteria[id] = { requirements: [], evidence: [], referencedIn: [] };
  }
  for (const id of definitions.task) {
    matrix.tasks[id] = { requirements: [], referencedIn: [] };
  }
  for (const id of definitions.evidence) {
    matrix.evidence[id] = { acceptance: [], referencedIn: [] };
  }

  for (const occurrence of occurrences) {
    const reqIds = occurrence.ids.requirement ?? [];
    const acIds = occurrence.ids.acceptance ?? [];
    const taskIds = occurrence.ids.task ?? [];
    const evIds = occurrence.ids.evidence ?? [];

    for (const req of reqIds) {
      matrix.requirements[req] ??= { acceptance: [], tasks: [], evidence: [], referencedIn: [] };
      matrix.requirements[req].referencedIn.push(occurrence.path);
      for (const ac of acIds) pushUnique(matrix.requirements[req].acceptance, ac);
      for (const task of taskIds) pushUnique(matrix.requirements[req].tasks, task);
    }
    for (const ac of acIds) {
      matrix.acceptanceCriteria[ac] ??= { requirements: [], evidence: [], referencedIn: [] };
      matrix.acceptanceCriteria[ac].referencedIn.push(occurrence.path);
      for (const req of reqIds) pushUnique(matrix.acceptanceCriteria[ac].requirements, req);
      for (const ev of evIds) pushUnique(matrix.acceptanceCriteria[ac].evidence, ev);
    }
    for (const task of taskIds) {
      matrix.tasks[task] ??= { requirements: [], referencedIn: [] };
      matrix.tasks[task].referencedIn.push(occurrence.path);
      for (const req of reqIds) pushUnique(matrix.tasks[task].requirements, req);
    }
    for (const ev of evIds) {
      matrix.evidence[ev] ??= { acceptance: [], referencedIn: [] };
      matrix.evidence[ev].referencedIn.push(occurrence.path);
      for (const ac of acIds) pushUnique(matrix.evidence[ev].acceptance, ac);
    }
  }

  for (const value of Object.values(matrix)) {
    for (const entry of Object.values(value)) {
      entry.referencedIn = Array.from(new Set(entry.referencedIn));
    }
  }

  return matrix;
}

function detectGaps({ definitions, matrix, byDocument, occurrences }) {
  const gaps = [];

  for (const [id, entry] of Object.entries(matrix.requirements)) {
    if (!entry.acceptance.length) {
      gaps.push({
        code: "REQUIREMENT_WITHOUT_ACCEPTANCE",
        id,
        message: `${id} 没有关联验收标准（AC）`
      });
    }
    if (!entry.tasks.length) {
      gaps.push({
        code: "REQUIREMENT_WITHOUT_TASK",
        id,
        message: `${id} 没有关联任务（TASK）`
      });
    }
  }

  for (const [id, entry] of Object.entries(matrix.acceptanceCriteria)) {
    if (!entry.evidence.length) {
      gaps.push({
        code: "ACCEPTANCE_WITHOUT_EVIDENCE",
        id,
        message: `${id} 没有关联验证证据（EV）`
      });
    }
    if (!entry.requirements.length) {
      gaps.push({
        code: "ACCEPTANCE_WITHOUT_REQUIREMENT",
        id,
        message: `${id} 未回溯到任何需求（REQ）`
      });
    }
  }

  for (const [id, entry] of Object.entries(matrix.tasks)) {
    if (!entry.requirements.length) {
      gaps.push({
        code: "TASK_WITHOUT_REQUIREMENT",
        id,
        message: `${id} 未关联需求（REQ）`
      });
    }
  }

  const duplicateIds = findDuplicateIds(byDocument);
  for (const duplicate of duplicateIds) {
    gaps.push({
      code: "DUPLICATE_ID",
      id: duplicate.id,
      message: `${duplicate.id} 在 ${duplicate.files.length} 个文档中重复定义`
    });
  }

  return gaps;
}

function findDuplicateIds(byDocument) {
  const seen = new Map();

  for (const document of byDocument) {
    for (const [kind, ids] of Object.entries(document.ids)) {
      if (!isDefinitionDocument(document.role, kind)) {
        continue;
      }
      for (const id of ids) {
        if (!seen.has(id)) {
          seen.set(id, new Set());
        }
        seen.get(id).add(document.path);
      }
    }
  }

  return Array.from(seen.entries())
    .filter(([, files]) => files.size > 1)
    .map(([id, files]) => ({ id, files: Array.from(files) }));
}

function pushUnique(list, value) {
  if (!list.includes(value)) {
    list.push(value);
  }
}

function emptyCounts() {
  return { requirements: 0, acceptanceCriteria: 0, tasks: 0, evidence: 0, documents: 0 };
}

function emptyMatrix() {
  return { requirements: {}, acceptanceCriteria: {}, tasks: {}, evidence: {} };
}

function toRelative(repoRoot, targetPath) {
  return path.relative(repoRoot, targetPath).split(path.sep).join("/");
}