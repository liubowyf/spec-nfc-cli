export const MODULES = {
  core: {
    name: "core",
    label: "核心骨架",
    description: "初始化最小可用骨架",
    required: true,
    dependencies: []
  },
  context: {
    name: "context",
    label: "上下文层",
    description: "提供系统、编码、架构与领域上下文",
    required: false,
    dependencies: ["core"]
  },
  execution: {
    name: "execution",
    label: "执行层",
    description: "提供 Agent 协议、输入输出和交接规则",
    required: false,
    dependencies: ["core"]
  },
  governance: {
    name: "governance",
    label: "治理层",
    description: "提供裁决点、发布交接、安全与多仓协作规则",
    required: false,
    dependencies: ["core"]
  },
  "design-api": {
    name: "design-api",
    label: "接口设计模块",
    description: "提供接口详细设计说明与模板",
    required: false,
    dependencies: ["core"]
  },
  "design-db": {
    name: "design-db",
    label: "数据库设计模块",
    description: "提供数据库详细设计、迁移与回滚模板",
    required: false,
    dependencies: ["core"]
  },
  quality: {
    name: "quality",
    label: "质量模块",
    description: "提供测试策略、回归清单与发布验证模板",
    required: false,
    dependencies: ["core"]
  },
  delivery: {
    name: "delivery",
    label: "交付集成模块",
    description: "提供 Git 提交、推送与交付约束模板",
    required: false,
    dependencies: ["core"]
  },
  "integration-contract": {
    name: "integration-contract",
    label: "对接契约模块",
    description: "提供多人接口 / service 对接模板与状态规则",
    required: false,
    dependencies: ["core"]
  }
};

export function getAllModuleNames() {
  return Object.keys(MODULES);
}

export function getRequiredModuleNames() {
  return Object.values(MODULES)
    .filter((module) => module.required)
    .map((module) => module.name);
}

export function parseModuleList(rawValue) {
  if (!rawValue) {
    return [];
  }

  const parts = Array.isArray(rawValue) ? rawValue : [rawValue];

  return Array.from(
    new Set(
      parts
        .flatMap((item) => String(item).split(","))
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

export function validateModules(moduleNames) {
  const invalid = moduleNames.filter((name) => !MODULES[name]);
  return {
    valid: invalid.length === 0,
    invalid
  };
}

export function expandModuleDependencies(moduleNames) {
  const result = new Set(getRequiredModuleNames());

  const visit = (name) => {
    if (!MODULES[name]) {
      return;
    }

    if (result.has(name)) {
      return;
    }

    for (const dependency of MODULES[name].dependencies) {
      visit(dependency);
    }

    result.add(name);
  };

  for (const moduleName of moduleNames) {
    visit(moduleName);
  }

  return Array.from(result);
}
