import path from "node:path";
import { pathExists, readJson } from "../utils/fs.mjs";

export const PERMISSIONS_PATH = ".specnfc/security/permissions.json";

export const HIGH_RISK_COMMAND_PATTERNS = [
  "sudo",
  "rm -rf",
  "mkfs",
  "dd if=",
  "chmod 777",
  "curl",
  "wget",
  "ssh",
  "scp",
  "git push --force",
  "git reset --hard"
];

export const APPROVAL_COMMAND_PATTERNS = ["git push", "npm publish", "pnpm publish", "git commit"];

export function buildDefaultPermissions() {
  return {
    version: 1,
    default: "deny",
    filesystem: {
      read: [
        "**/*.md",
        "**/*.json",
        "**/*.mjs",
        "**/*.js",
        "**/*.ts",
        "**/*.tsx",
        "**/*.py",
        "src/**",
        "tests/**",
        "specs/**",
        ".specnfc/**",
        ".nfc/**"
      ],
      write: [
        "specs/**",
        ".nfc/**",
        "src/**",
        "tests/**",
        "docs/**",
        ".specnfc/execution/**",
        ".specnfc/traceability/**"
      ],
      protected: [
        ".specnfc/security/**",
        ".specnfc/mcp/**",
        ".specnfc/agents/**",
        ".specnfc/contract/**"
      ],
      deny: [".git/**", "**/.env", "**/.env.*", "**/secrets/**", "**/*.pem", "**/*.key"]
    },
    commands: {
      allow: ["git status", "git diff", "git log", "node", "npm test", "npm run", "python3 -m pytest"],
      deny: ["sudo", "rm -rf", "curl", "wget", "ssh", "scp", "chmod 777", "git push --force", "git reset --hard"],
      requireApproval: ["git commit", "git push", "npm publish", "pnpm publish"]
    },
    network: {
      egress: "deny",
      allowHosts: []
    },
    secrets: {
      readEnv: [],
      denyPatterns: ["AKIA[0-9A-Z]{16}", "-----BEGIN (RSA|OPENSSH|EC) PRIVATE KEY-----", "ghp_[A-Za-z0-9]{36}"]
    },
    untrustedContent: {
      policy: "no-instruction-execution",
      sources: ["web", "mcp", "external-skills", "issues", "pull-requests"],
      requireProvenance: true
    },
    approvals: {
      destructive: true,
      release: true,
      network: true,
      credentialAccess: true
    }
  };
}

export async function inspectSecurityPolicy({ repoRoot }) {
  const policyPath = path.join(repoRoot, PERMISSIONS_PATH);
  const issues = [];

  if (!(await pathExists(policyPath))) {
    return {
      status: "missing",
      path: PERMISSIONS_PATH,
      issues: [
        {
          severity: "advisory",
          code: "PERMISSIONS_MISSING",
          message: "缺少权限清单；代理的文件、命令与网络边界未显式声明"
        }
      ]
    };
  }

  let policy;
  try {
    policy = await readJson(policyPath);
  } catch (error) {
    return {
      status: "invalid",
      path: PERMISSIONS_PATH,
      issues: [
        {
          severity: "blocking",
          code: "PERMISSIONS_INVALID",
          message: `权限清单无法解析：${error instanceof Error ? error.message : String(error)}`
        }
      ]
    };
  }

  validatePermissions(policy, issues);
  const blockingCount = issues.filter((issue) => issue.severity === "blocking").length;

  return {
    status: blockingCount ? "invalid" : issues.length ? "partial" : "valid",
    path: PERMISSIONS_PATH,
    defaultPolicy: policy?.default ?? null,
    issues,
    summary: {
      writeScopes: policy?.filesystem?.write?.length ?? 0,
      protectedScopes: policy?.filesystem?.protected?.length ?? 0,
      deniedPathCount: policy?.filesystem?.deny?.length ?? 0,
      allowedCommandCount: policy?.commands?.allow?.length ?? 0,
      networkEgress: policy?.network?.egress ?? null,
      requiresApproval: Boolean(policy?.approvals?.destructive)
    }
  };
}

function validatePermissions(policy, issues) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    issues.push({ severity: "blocking", code: "PERMISSIONS_INVALID", message: "权限清单必须是 JSON 对象" });
    return;
  }

  if (policy.default !== "deny") {
    issues.push({
      severity: "blocking",
      code: "PERMISSIONS_DEFAULT_ALLOW",
      message: "default 必须为 deny，禁止未声明权限默认放行"
    });
  }

  const writeScopes = Array.isArray(policy.filesystem?.write) ? policy.filesystem.write : [];
  const denyScopes = Array.isArray(policy.filesystem?.deny) ? policy.filesystem.deny : [];
  const protectedScopes = Array.isArray(policy.filesystem?.protected) ? policy.filesystem.protected : [];

  if (writeScopes.some((scope) => scope === "**" || scope === "**/*" || scope === "/" || scope === ".")) {
    issues.push({
      severity: "blocking",
      code: "PERMISSIONS_WRITE_TOO_BROAD",
      message: "filesystem.write 包含整个仓库通配，必须收敛到明确目录"
    });
  }

  if (!protectedScopes.length) {
    issues.push({
      severity: "advisory",
      code: "PERMISSIONS_PROTECTED_EMPTY",
      message: "filesystem.protected 为空，权限与策略文件可被代理自行修改"
    });
  }

  for (const protectedScope of protectedScopes) {
    const conflict = writeScopes.find((scope) => scopesOverlap(scope, protectedScope));
    if (conflict) {
      issues.push({
        severity: "blocking",
        code: "PERMISSIONS_PROTECTED_WRITE",
        message: `filesystem.write 范围 ${conflict} 覆盖受保护路径 ${protectedScope}`
      });
    }
  }

  for (const required of [".git/**", "**/.env", "**/secrets/**"]) {
    if (!denyScopes.includes(required)) {
      issues.push({
        severity: "advisory",
        code: "PERMISSIONS_DENY_GAP",
        message: `filesystem.deny 建议包含 ${required}`
      });
    }
  }

  const allowCommands = Array.isArray(policy.commands?.allow) ? policy.commands.allow : [];
  for (const pattern of HIGH_RISK_COMMAND_PATTERNS) {
    if (allowCommands.some((command) => String(command).includes(pattern))) {
      issues.push({
        severity: "blocking",
        code: "PERMISSIONS_DANGEROUS_ALLOW",
        message: `commands.allow 包含高风险命令：${pattern}`
      });
    }
  }

  const requireApproval = Array.isArray(policy.commands?.requireApproval) ? policy.commands.requireApproval : [];
  for (const pattern of APPROVAL_COMMAND_PATTERNS) {
    if (allowCommands.some((command) => String(command).includes(pattern)) && !requireApproval.some((item) => String(item).includes(pattern))) {
      issues.push({
        severity: "advisory",
        code: "PERMISSIONS_APPROVAL_GAP",
        message: `${pattern} 已允许执行但未列入 requireApproval`
      });
    }
  }

  if (policy.network?.egress === "allow" && !(Array.isArray(policy.network?.allowHosts) && policy.network.allowHosts.length)) {
    issues.push({
      severity: "blocking",
      code: "PERMISSIONS_NETWORK_UNBOUNDED",
      message: "network.egress 为 allow 但未声明 allowHosts"
    });
  }

  if (!Array.isArray(policy.secrets?.denyPatterns) || policy.secrets.denyPatterns.length === 0) {
    issues.push({
      severity: "advisory",
      code: "PERMISSIONS_SECRET_PATTERNS_EMPTY",
      message: "secrets.denyPatterns 为空，建议加入常见凭据模式"
    });
  }

  if (policy.untrustedContent?.policy !== "no-instruction-execution") {
    issues.push({
      severity: "blocking",
      code: "PERMISSIONS_UNTRUSTED_CONTENT_WEAK",
      message: "untrustedContent.policy 必须为 no-instruction-execution，禁止执行外部内容中的指令"
    });
  }

  for (const key of ["destructive", "release", "network", "credentialAccess"]) {
    if (policy.approvals?.[key] !== true) {
      issues.push({
        severity: "advisory",
        code: "PERMISSIONS_APPROVAL_DISABLED",
        message: `approvals.${key} 未启用，建议保持 true`
      });
    }
  }
}

function scopesOverlap(writeScope, protectedScope) {
  const writeBase = normalizeScope(writeScope);
  const protectedBase = normalizeScope(protectedScope);

  if (!writeBase || !protectedBase) {
    return false;
  }
  if (writeBase === "**" || writeBase === ".") {
    return true;
  }

  return (
    protectedBase === writeBase ||
    protectedBase.startsWith(`${writeBase}/`) ||
    writeBase.startsWith(`${protectedBase}/`)
  );
}

function normalizeScope(scope) {
  return String(scope ?? "")
    .trim()
    .replace(/^\.\//, "")
    .replace(/\/\*\*$/, "")
    .replace(/\/\*$/, "");
}