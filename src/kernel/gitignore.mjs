import { getRepoPaths } from "./paths.mjs";
import { pathExists, readText, writeText } from "../utils/fs.mjs";

const BLOCK_START = "# >>> specnfc local runtime >>>";
const BLOCK_END = "# <<< specnfc local runtime <<<";

const DEFAULT_RULES = [
  ".nfc/context/",
  ".nfc/interviews/",
  ".nfc/plans/",
  ".nfc/logs/",
  ".nfc/handoffs/",
  ".nfc/notes/",
  ".nfc/specs/",
  ".nfc/sync/",
  ".nfc/imports/",
  ".nfc/skills/",
  ".nfc/state/",
  "!.nfc/README.md",
  "!.nfc/runtime.json"
];

function buildManagedBlock() {
  return [BLOCK_START, ...DEFAULT_RULES, BLOCK_END].join("\n");
}

export async function ensureSpecnfcGitignore({ repoRoot, dryRun = false }) {
  const { gitignorePath } = getRepoPaths(repoRoot);
  const existing = (await pathExists(gitignorePath)) ? await readText(gitignorePath) : "";
  const block = buildManagedBlock();
  let nextContent = "";

  if (existing.includes(BLOCK_START) && existing.includes(BLOCK_END)) {
    nextContent = existing.replace(
      new RegExp(`${escapeRegExp(BLOCK_START)}[\\s\\S]*?${escapeRegExp(BLOCK_END)}`, "m"),
      block
    );
  } else if (existing.trim()) {
    nextContent = `${existing.replace(/\s*$/, "")}\n\n${block}\n`;
  } else {
    nextContent = `${block}\n`;
  }

  const changed = normalizeLineEndings(existing) !== normalizeLineEndings(nextContent);
  const created = !existing;

  if (!dryRun && changed) {
    await writeText(gitignorePath, nextContent);
  }

  return {
    path: ".gitignore",
    created,
    updated: changed && !created,
    changed,
    skipped: !changed
  };
}

function normalizeLineEndings(content) {
  return String(content || "").replace(/\r\n/g, "\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
