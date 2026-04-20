import { createHash } from "node:crypto";

export function hashManagedContent(content) {
  return createHash("sha256").update(String(content), "utf8").digest("hex");
}

export function getManagedFileHashes(config) {
  return {
    ...(config.managedFiles || {})
  };
}

export function trackManagedFiles(config, entries) {
  const nextConfig = structuredClone(config);
  nextConfig.managedFiles = {
    ...getManagedFileHashes(nextConfig),
    ...entries
  };
  return nextConfig;
}
