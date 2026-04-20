export const PROFILES = {
  minimal: {
    name: "minimal",
    label: "最小模式",
    description: "仅初始化核心骨架",
    modules: []
  },
  standard: {
    name: "standard",
    label: "标准模式",
    description: "初始化上下文层、执行层与治理层",
    modules: ["context", "execution", "governance"]
  },
  enterprise: {
    name: "enterprise",
    label: "企业模式",
    description: "初始化企业团队常用的上下文、执行、治理、接口设计、数据库设计、质量与对接契约模块",
    modules: ["context", "execution", "governance", "design-api", "design-db", "quality", "delivery", "integration-contract"]
  }
};

export function normalizeProfileName(rawProfile) {
  return String(rawProfile || "minimal").trim().toLowerCase();
}

export function getProfileNames() {
  return Object.keys(PROFILES);
}

export function isValidProfile(profileName) {
  return Boolean(PROFILES[profileName]);
}

export function getProfile(profileName) {
  return PROFILES[profileName];
}
