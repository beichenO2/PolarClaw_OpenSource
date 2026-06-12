/**
 * PolarUser — 统一用户身份模型
 *
 * 区分 PolarUser.human（admin/normal）和 PolarUser.project（每个被托管项目一个身份）。
 * project 用户与 human 用户平级，共享 user_id / memory / persona 机制，
 * 但属于单独 PolarUser.project 组，拥有 SDK 接口和触发式启动逻辑。
 *
 * 设计约束：
 * - polaris.json 不引入 lobster_* 字段
 * - 靶子树通过 polaris_feature_ref 单向引用 polaris features
 * - 项目侧不实现 Pilot Runtime 大脑
 */

export type PolarUserKind = 'human' | 'project';
export type PolarUserGroup = 'PolarUser.human' | 'PolarUser.project';

export interface PolarUser {
  id: string;
  kind: PolarUserKind;
  group: PolarUserGroup;
  display_name: string;
  project_id?: string;
  persona: string;
  memory_namespace: string;
  tool_scopes: string[];
  sdk_scopes: string[];
}

export interface PolarUserRegistryConfig {
  humans?: Record<string, Partial<PolarUser>>;
  projects?: Record<string, Partial<PolarUser>>;
}

const DEFAULT_HUMAN_SCOPES = ['*'];
const DEFAULT_PROJECT_TOOL_SCOPES = ['read', 'test', 'write-targets'];
const DEFAULT_PROJECT_SDK_SCOPES = ['events:emit', 'status:read', 'health:run'];

function makeHumanUser(userId: string, overrides?: Partial<PolarUser>): PolarUser {
  return {
    id: userId,
    kind: 'human',
    group: 'PolarUser.human',
    display_name: overrides?.display_name ?? userId,
    persona: overrides?.persona ?? userId,
    memory_namespace: userId,
    tool_scopes: overrides?.tool_scopes ?? DEFAULT_HUMAN_SCOPES,
    sdk_scopes: overrides?.sdk_scopes ?? [],
    ...overrides,
  };
}

function makeProjectUser(projectId: string, overrides?: Partial<PolarUser>): PolarUser {
  const id = `project:${projectId}`;
  const scopePrefix = projectId.toLowerCase();
  return {
    id,
    kind: 'project',
    group: 'PolarUser.project',
    display_name: overrides?.display_name ?? `${projectId} Lobster`,
    project_id: projectId,
    persona: overrides?.persona ?? `lobster-${projectId.toLowerCase()}`,
    memory_namespace: id,
    tool_scopes: overrides?.tool_scopes ??
      DEFAULT_PROJECT_TOOL_SCOPES.map(s => `${scopePrefix}:${s}`),
    sdk_scopes: overrides?.sdk_scopes ?? DEFAULT_PROJECT_SDK_SCOPES,
    ...overrides,
  };
}

export function createPolarUserRegistry(config?: PolarUserRegistryConfig) {
  const users = new Map<string, PolarUser>();

  const defaultHumans: Record<string, Partial<PolarUser>> = {
    admin: { display_name: 'Admin', persona: 'admin' },
    ...config?.humans,
  };

  const defaultProjects: Record<string, Partial<PolarUser>> = {
    knowlever: { display_name: 'KnowLever Lobster' },
    autooffice: { display_name: 'AutoOffice Lobster' },
    clock: { display_name: 'Clock Lobster' },
    tqsdk: { display_name: 'tqsdk Lobster' },
    digist: { display_name: 'Digist Lobster' },
    sotagent: { display_name: 'SOTAgent Lobster' },
    polarcopilot: { display_name: 'PolarCopilot Lobster' },
    ...config?.projects,
  };

  for (const [id, overrides] of Object.entries(defaultHumans)) {
    const user = makeHumanUser(id, overrides);
    users.set(user.id, user);
  }

  for (const [projectId, overrides] of Object.entries(defaultProjects)) {
    const user = makeProjectUser(projectId, overrides);
    users.set(user.id, user);
  }

  return {
    resolve(userId: string): PolarUser {
      const existing = users.get(userId);
      if (existing) return existing;

      if (userId.startsWith('project:')) {
        const projectId = userId.slice('project:'.length);
        const user = makeProjectUser(projectId);
        users.set(userId, user);
        return user;
      }

      const user = makeHumanUser(userId);
      users.set(userId, user);
      return user;
    },

    get(userId: string): PolarUser | undefined {
      return users.get(userId);
    },

    register(user: PolarUser): void {
      users.set(user.id, user);
    },

    listByGroup(group: PolarUserGroup): PolarUser[] {
      return Array.from(users.values()).filter(u => u.group === group);
    },

    listProjects(): PolarUser[] {
      return this.listByGroup('PolarUser.project');
    },

    listHumans(): PolarUser[] {
      return this.listByGroup('PolarUser.human');
    },

    isProject(userId: string): boolean {
      return userId.startsWith('project:');
    },

    isHuman(userId: string): boolean {
      return !userId.startsWith('project:');
    },

    /** 检查用户是否有指定 tool scope 权限 */
    hasToolScope(userId: string, scope: string): boolean {
      const user = this.resolve(userId);
      if (user.tool_scopes.includes('*')) return true;
      return user.tool_scopes.includes(scope);
    },

    /** 检查用户是否有指定 SDK scope 权限 */
    hasSdkScope(userId: string, scope: string): boolean {
      const user = this.resolve(userId);
      return user.sdk_scopes.includes(scope);
    },

    /** 获取项目用户的 persona 文件名（不含 .md） */
    getPersonaName(userId: string): string {
      return this.resolve(userId).persona;
    },

    /** 获取用户的 memory 命名空间 */
    getMemoryNamespace(userId: string): string {
      return this.resolve(userId).memory_namespace;
    },

    toJSON(): PolarUser[] {
      return Array.from(users.values());
    },
  };
}

export type PolarUserRegistry = ReturnType<typeof createPolarUserRegistry>;
