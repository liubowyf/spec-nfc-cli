import { access, mkdir, readFile, readdir, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export async function pathExists(targetPath) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath) {
  await mkdir(targetPath, { recursive: true });
}

export async function readText(targetPath) {
  return readFile(targetPath, "utf8");
}

export async function writeText(targetPath, content) {
  await ensureDir(path.dirname(targetPath));
  await writeFile(targetPath, content, "utf8");
}

export async function readJson(targetPath) {
  return JSON.parse(await readText(targetPath));
}

export async function writeJson(targetPath, data) {
  await writeText(targetPath, `${JSON.stringify(data, null, 2)}\n`);
}

export async function resolvePathInsideRoot(rootPath, relativePath) {
  const normalizedRelative = String(relativePath ?? "").trim();

  if (!normalizedRelative) {
    throw new Error("WRITE_DENIED: 路径不能为空");
  }

  if (path.isAbsolute(normalizedRelative)) {
    throw new Error(`WRITE_DENIED: 禁止使用绝对路径：${normalizedRelative}`);
  }

  const targetPath = path.resolve(rootPath, normalizedRelative);
  await assertPathInsideRoot(rootPath, targetPath);
  return targetPath;
}

export async function assertPathInsideRoot(rootPath, targetPath) {
  const normalizedRoot = path.resolve(rootPath);
  const normalizedTarget = path.resolve(targetPath);

  if (!isPathInsideRoot(normalizedRoot, normalizedTarget)) {
    throw new Error(`WRITE_DENIED: 路径超出仓库边界：${normalizedTarget}`);
  }

  const projectedRoot = await projectPathWithRealAncestors(normalizedRoot);
  const projectedTarget = await projectPathWithRealAncestors(normalizedTarget);
  if (!isPathInsideRoot(projectedRoot, projectedTarget)) {
    throw new Error(`WRITE_DENIED: 路径通过符号链接超出仓库边界：${normalizedTarget}`);
  }

  return normalizedTarget;
}

export async function removePath(targetPath) {
  await rm(targetPath, { recursive: true, force: true });
}

export async function movePath(sourcePath, targetPath) {
  await ensureDir(path.dirname(targetPath));
  await rename(sourcePath, targetPath);
}

export async function isDirectory(targetPath) {
  try {
    return (await stat(targetPath)).isDirectory();
  } catch {
    return false;
  }
}

export async function isFile(targetPath) {
  try {
    return (await stat(targetPath)).isFile();
  } catch {
    return false;
  }
}

export async function listDir(targetPath) {
  return readdir(targetPath);
}

function isPathInsideRoot(rootPath, targetPath) {
  const relative = path.relative(rootPath, targetPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function projectPathWithRealAncestors(targetPath) {
  const missingSegments = [];
  let currentPath = path.resolve(targetPath);

  while (!(await pathExists(currentPath))) {
    const parentPath = path.dirname(currentPath);
    if (parentPath === currentPath) {
      break;
    }
    missingSegments.unshift(path.basename(currentPath));
    currentPath = parentPath;
  }

  const realCurrentPath = await realpath(currentPath);
  return path.resolve(realCurrentPath, ...missingSegments);
}
