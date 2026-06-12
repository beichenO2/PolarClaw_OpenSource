/**
 * Skills Port — 技能系统抽象
 *
 * 支持 SKILL.md 格式的技能发现、加载、注册。
 * 支持运行时热加载、反馈学习、技能生成和技能组合。
 */

/** 技能元数据 */
export interface ISkillMeta {
  name: string;
  description: string;
  version?: string;
  /** 技能依赖（如 clock-backend: "http://127.0.0.1:15550"） */
  requires?: Record<string, string>;
  /** SKILL.md 文件路径 */
  path: string;
  /** 技能来源：static = 预置, generated = Agent 生成, composed = 组合 */
  origin?: 'static' | 'generated' | 'composed';
  /** 验证状态：draft = 草稿(新生成), verified = 已验证(成功使用≥3次), retired = 已退役 */
  status?: 'draft' | 'verified' | 'retired';
  /** 生成后的成功使用次数 */
  successfulUses?: number;
  /** 生成时间 */
  createdAt?: string;
  /** 此技能包含的工具名称列表（加载后填充） */
  toolNames?: string[];
}

/** 技能加载器接口 */
export interface ISkillLoader {
  /** 从目录扫描并加载技能 */
  scan(dirs: string[]): ISkillMeta[];

  /** 将技能注册为 Agent 工具（动态导入 tools.ts，需 async） */
  registerTools(skills: ISkillMeta[], register: (tool: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<unknown>;
  }) => void): Promise<void>;
}

/** 技能生命周期事件 */
export type SkillEvent =
  | { type: 'loaded'; skill: ISkillMeta }
  | { type: 'unloaded'; skillName: string }
  | { type: 'reloaded'; skill: ISkillMeta }
  | { type: 'error'; skillName: string; error: string };

export type SkillEventHandler = (event: SkillEvent) => void;

/** 元技能条目 — 轻量描述，不含工具实现 */
export interface ISkillIndexEntry {
  name: string;
  description: string;
  /** 此技能提供的工具名列表（仅名称） */
  toolNames: string[];
  origin: 'static' | 'generated' | 'composed' | 'downloaded';
  status: 'draft' | 'verified' | 'retired';
  /** 是否当前已激活（工具已注册到执行器） */
  activated: boolean;
  /** 技能目录路径 */
  skillDir: string;
}

/** 技能发现结果 */
export interface ISkillSearchResult {
  entries: ISkillIndexEntry[];
  source: 'local' | 'ecosystem';
  query: string;
}

/** 技能注册表 — 运行时管理所有技能的生命周期 */
export interface ISkillRegistry {
  /** 首次启动：扫描 + 注册技能。loadTools=false 时仅注册目录不加载工具。 */
  init(scanDirs: string[], options?: { loadTools?: boolean }): Promise<void>;

  /** 开启文件监听，变更时自动热加载 */
  watch(): void;

  /** 停止文件监听 */
  unwatch(): void;

  /** 运行时加载单个技能目录 */
  loadSkill(skillDir: string): Promise<ISkillMeta | null>;

  /** 运行时卸载技能（取消注册所有工具） */
  unloadSkill(skillName: string): boolean;

  /** 获取所有已加载技能 */
  listSkills(): ISkillMeta[];

  /** 按名称查找技能 */
  getSkill(name: string): ISkillMeta | undefined;

  /** 监听技能事件 */
  on(handler: SkillEventHandler): void;

  /** 取消监听 */
  off(handler: SkillEventHandler): void;

  /** 便捷钩子：技能加载时触发 */
  onSkillLoaded(callback: (skill: ISkillMeta) => void): void;

  /** 便捷钩子：技能卸载时触发 */
  onSkillUnloaded(callback: (skillName: string) => void): void;
}
