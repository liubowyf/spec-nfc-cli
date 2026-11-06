import path from "node:path";
import { pathExists, readJson } from "../utils/fs.mjs";

export const MCP_POLICY_PATH = ".specnfc/mcp/policy.json";
export const MCP_LATEST_PROTOCOL_VERSION = "2026-07-28";
export const SUPPORTED_MCP_TRANSPORTS = ["streamable-http", "stdio"];
export const MCP_TRUST_TIERS = ["untrusted", "workspace", "trusted"];
export const CANONICAL_PHASES = ["clarify", "design", "plan", "execute", "verify", "accept", "archive"];
export const PHASE_TOOL_MODES = ["deny", "approval", "allow"];

export function buildDefaultMcpPolicy() {
  return {
    version: 1,
    protocolVersion: MCP_LATEST_PROTOCOL_VERSION,
    transport: "streamable-http",
    stateless: true,
    defaults: {
      trustTier: "untrusted",
      networkEgress: "deny",
      requireAuthorization: true,
      allowSampling: false,
      allowElicitation: false,
      allowRoots: false,
      cacheListResults: true
    },
    servers: [],
    phaseToolPolicy: {
      clarify: { readTools: "allow", writeTools: "deny", network: "deny" },
      design: { readTools: "allow", writeTools: "deny", network: "deny" },
      plan: { readTools: "allow", writeTools: "approval", network: "deny" },
      execute: { readTools: "allow", writeTools: "approval", network: "approval" },
      verify: { readTools: "allow", writeTools: "approval", network: "approval" },
      accept: { readTools: "allow", writeTools: "approval", network: "deny" },
      archive: { readTools: "allow", writeTools: "approval", network: "deny" }
    },
    approvalRequiredFor: ["destructive", "network-egress", "credential-access", "release"],
    deniedToolPatterns: ["shell:*", "fs:delete", "git:force-push", "secrets:*"],
    telemetry: {
      traceContext: "w3c-traceparent",
      attributes: ["gen_ai.operation.name", "gen_ai.tool.name", "mcp.server.name", "mcp.tool.name"]
    }
  };
}

export async function inspectMcpPolicy({ repoRoot }) {
  const policyPath = path.join(repoRoot, MCP_POLICY_PATH);
  const issues = [];

  if (!(await pathExists(policyPath))) {
    return {
      status: "missing",
      path: MCP_POLICY_PATH,
      protocolVersion: null,
      serverCount: 0,
      issues: [
        {
          severity: "advisory",
          code: "MCP_POLICY_MISSING",
          message: "缺少 MCP 工具策略；代理无法判断哪些外部工具可用"
        }
      ],
      servers: []
    };
  }

  let policy;
  try {
    policy = await readJson(policyPath);
  } catch (error) {
    return {
      status: "invalid",
      path: MCP_POLICY_PATH,
      protocolVersion: null,
      serverCount: 0,
      issues: [
        {
          severity: "blocking",
          code: "MCP_POLICY_INVALID",
          message: `MCP 策略无法解析：${error instanceof Error ? error.message : String(error)}`
        }
      ],
      servers: []
    };
  }

  validatePolicy(policy, issues);
  const servers = Array.isArray(policy?.servers) ? policy.servers : [];
  const blockingCount = issues.filter((issue) => issue.severity === "blocking").length;

  return {
    status: blockingCount ? "invalid" : issues.length ? "partial" : "valid",
    path: MCP_POLICY_PATH,
    protocolVersion: policy?.protocolVersion ?? null,
    serverCount: servers.length,
    trustTierCounts: countTrustTiers(servers),
    issues,
    servers: servers.map((server) => ({
      name: server?.name ?? null,
      transport: server?.transport ?? null,
      trustTier: server?.trustTier ?? null,
      toolCount: Array.isArray(server?.allowedTools) ? server.allowedTools.length : 0,
      writeAccess: Boolean(server?.writeAccess),
      authorization: Boolean(server?.authorization)
    }))
  };
}

function validatePolicy(policy, issues) {
  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    issues.push({ severity: "blocking", code: "MCP_POLICY_INVALID", message: "MCP 策略必须是 JSON 对象" });
    return;
  }

  if (policy.protocolVersion !== MCP_LATEST_PROTOCOL_VERSION) {
    issues.push({
      severity: "advisory",
      code: "MCP_PROTOCOL_OUTDATED",
      message: `MCP 协议版本建议使用 ${MCP_LATEST_PROTOCOL_VERSION}，当前为 ${policy.protocolVersion ?? "未声明"}`
    });
  }

  if (!Array.isArray(policy.servers)) {
    issues.push({ severity: "blocking", code: "MCP_SERVERS_INVALID", message: "servers 必须是数组" });
  } else {
    const seen = new Set();
    for (const [index, server] of policy.servers.entries()) {
      validateServer(server, index, seen, policy, issues);
    }
  }

  validatePhaseToolPolicy(policy.phaseToolPolicy, issues);

  if (!Array.isArray(policy.deniedToolPatterns) || policy.deniedToolPatterns.length === 0) {
    issues.push({
      severity: "advisory",
      code: "MCP_DENYLIST_EMPTY",
      message: "deniedToolPatterns 为空，建议显式拒绝 shell / 删除 / 强推等高风险工具"
    });
  }

  if (!Array.isArray(policy.approvalRequiredFor) || !policy.approvalRequiredFor.includes("destructive")) {
    issues.push({
      severity: "advisory",
      code: "MCP_APPROVAL_POLICY_WEAK",
      message: "approvalRequiredFor 建议至少包含 destructive"
    });
  }

  if (policy.telemetry && policy.telemetry.traceContext !== "w3c-traceparent") {
    issues.push({
      severity: "advisory",
      code: "MCP_TRACE_CONTEXT_UNKNOWN",
      message: "建议使用 w3c-traceparent 作为跨代理 trace 上下文"
    });
  }
}

function validateServer(server, index, seen, policy, issues) {
  const label = `servers[${index}]`;

  if (!server || typeof server !== "object" || Array.isArray(server)) {
    issues.push({ severity: "blocking", code: "MCP_SERVER_INVALID", message: `${label} 必须是对象` });
    return;
  }

  const name = String(server.name ?? "").trim();
  if (!name) {
    issues.push({ severity: "blocking", code: "MCP_SERVER_NAME_MISSING", message: `${label} 缺少 name` });
  } else if (seen.has(name)) {
    issues.push({ severity: "blocking", code: "MCP_SERVER_DUPLICATE", message: `MCP server 名称重复：${name}` });
  } else {
    seen.add(name);
  }

  const transport = String(server.transport ?? policy?.transport ?? "streamable-http");
  if (transport === "sse") {
    issues.push({
      severity: "advisory",
      code: "MCP_TRANSPORT_DEPRECATED",
      message: `${name || label} 使用已废弃的 HTTP+SSE 传输，建议迁移到 streamable-http`
    });
  } else if (!SUPPORTED_MCP_TRANSPORTS.includes(transport)) {
    issues.push({
      severity: "blocking",
      code: "MCP_TRANSPORT_UNSUPPORTED",
      message: `${name || label} 使用不支持的传输：${transport}`
    });
  }

  const trustTier = String(server.trustTier ?? policy?.defaults?.trustTier ?? "untrusted");
  if (!MCP_TRUST_TIERS.includes(trustTier)) {
    issues.push({
      severity: "blocking",
      code: "MCP_TRUST_TIER_INVALID",
      message: `${name || label} 的 trustTier 非法：${trustTier}`
    });
  }

  const allowedTools = Array.isArray(server.allowedTools) ? server.allowedTools : [];
  if (!allowedTools.length) {
    issues.push({
      severity: "advisory",
      code: "MCP_TOOLS_EMPTY",
      message: `${name || label} 未声明 allowedTools，建议显式列出可用工具`
    });
  }
  if (allowedTools.some((tool) => tool === "*" || String(tool).includes("*"))) {
    issues.push({
      severity: "blocking",
      code: "MCP_TOOLS_WILDCARD",
      message: `${name || label} 使用通配符工具授权，违反最小权限原则`
    });
  }

  if (transport === "streamable-http" && !server.authorization && policy?.defaults?.requireAuthorization !== false) {
    issues.push({
      severity: server.writeAccess === true ? "blocking" : "advisory",
      code: "MCP_AUTHORIZATION_MISSING",
      message: `${name || label} 未声明 authorization，远程 MCP server 应要求授权`
    });
  }

  if (server.networkEgress === "allow" && !(Array.isArray(server.allowHosts) && server.allowHosts.length)) {
    issues.push({
      severity: "advisory",
      code: "MCP_EGRESS_UNBOUNDED",
      message: `${name || label} 允许网络出口但未声明 allowHosts`
    });
  }

  if (trustTier === "untrusted" && server.writeAccess === true) {
    const hasApproval = Array.isArray(server.approvalFor) && server.approvalFor.includes("write");
    if (!hasApproval) {
      issues.push({
        severity: "blocking",
        code: "MCP_UNTRUSTED_WRITE",
        message: `${name || label} 为 untrusted 且具备写能力，必须声明 approvalFor: [\"write\"]`
      });
    }
  }

  if (server.networkEgress === "allow" && trustTier === "untrusted") {
    issues.push({
      severity: "advisory",
      code: "MCP_UNTRUSTED_EGRESS",
      message: `${name || label} 为 untrusted 且允许网络出口，需明确 allowHosts`
    });
  }

  for (const capability of ["sampling", "logging", "roots"]) {
    if (server.capabilities?.[capability] === true) {
      issues.push({
        severity: "advisory",
        code: "MCP_CAPABILITY_DEPRECATED",
        message: `${name || label} 启用了 ${capability}：在 ${MCP_LATEST_PROTOCOL_VERSION} 中已废弃`
      });
    }
  }
}

function validatePhaseToolPolicy(phaseToolPolicy, issues) {
  if (!phaseToolPolicy || typeof phaseToolPolicy !== "object" || Array.isArray(phaseToolPolicy)) {
    issues.push({
      severity: "blocking",
      code: "MCP_PHASE_POLICY_MISSING",
      message: "缺少 phaseToolPolicy，无法按阶段约束工具权限"
    });
    return;
  }

  for (const phase of CANONICAL_PHASES) {
    const entry = phaseToolPolicy[phase];
    if (!entry) {
      issues.push({
        severity: "advisory",
        code: "MCP_PHASE_POLICY_GAP",
        message: `phaseToolPolicy 缺少阶段：${phase}`
      });
      continue;
    }
    for (const key of ["readTools", "writeTools", "network"]) {
      if (entry[key] && !PHASE_TOOL_MODES.includes(entry[key])) {
        issues.push({
          severity: "blocking",
          code: "MCP_PHASE_MODE_INVALID",
          message: `${phase}.${key} 非法：${entry[key]}`
        });
      }
    }
  }

  if (phaseToolPolicy.clarify?.writeTools === "allow") {
    issues.push({
      severity: "advisory",
      code: "MCP_CLARIFY_WRITE_ALLOWED",
      message: "clarify 阶段允许写工具，建议改为 deny 以保持需求澄清只读"
    });
  }
}

function countTrustTiers(servers) {
  const counts = {};
  for (const server of servers) {
    const tier = server?.trustTier ?? "untrusted";
    counts[tier] = (counts[tier] ?? 0) + 1;
  }
  return counts;
}