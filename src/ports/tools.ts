/**
 * Tools Port — 工具注册与执行抽象
 *
 * Agent 的工具系统：注册、发现、执行、安全检查。
 */

import type { IToolDefinition } from './llm.js';

/** 工具处理器 */
export interface IToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

/** 工具执行器接口 */
export interface IToolExecutor {
  /** 注册工具 */
  register(tool: IToolHandler): void;

  /** 取消注册工具（热卸载用） */
  unregister(name: string): boolean;

  /** 执行工具 */
  execute(name: string, args: Record<string, unknown>): Promise<unknown>;

  /** 列出所有已注册工具（function calling 格式） */
  list(): IToolDefinition[];

  /** 检查工具是否已注册 */
  has(name: string): boolean;
}
