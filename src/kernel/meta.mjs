import { readJson } from "../utils/fs.mjs";
import { PROJECT_ROOT } from "./paths.mjs";

let cachedMeta = null;

export async function getPackageMeta() {
  if (cachedMeta) {
    return cachedMeta;
  }

  cachedMeta = await readJson(`${PROJECT_ROOT}/package.json`);
  return cachedMeta;
}
