/**
 * Auto-generated composite tool: search_then_read
 * 自动生成的组合工具：查询后阅读（knowlever_search → doc_reader）
 *
 * Generated at: 2026-06-12T02:06:32.078Z
 */

import type { IToolHandler } from '../../src/ports/tools.js';

/**
 * 工具注册表引用，由 SkillRegistry 注入。
 * 组合技能通过此 Map 调用其他已注册工具。
 */
export const toolRegistry = new Map<string, (args: Record<string, unknown>) => Promise<unknown>>();

export const searchThenReadTool: IToolHandler = {
  name: 'search_then_read',
  description: '自动生成的组合工具：查询后阅读（knowlever_search → doc_reader）',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'query' },
      url: { type: 'string', description: 'url' },
    },
    required: [],
  },
  async handler(args: Record<string, unknown>) {

    // Step 1: knowlever_search
    const step1Args = { query: args.query };
    let step1Result: unknown;
    try {
      const handler = toolRegistry.get('knowlever_search');
      step1Result = handler ? await handler(step1Args) : { error: 'tool not found: knowlever_search' };
    } catch (e) {
      step1Result = { error: e instanceof Error ? e.message : String(e) };
    }

    // Step 2: doc_reader
    const step2Args = { url: args.url };
    let step2Result: unknown;
    try {
      const handler = toolRegistry.get('doc_reader');
      step2Result = handler ? await handler(step2Args) : { error: 'tool not found: doc_reader' };
    } catch (e) {
      step2Result = { error: e instanceof Error ? e.message : String(e) };
    }

    return {
      step1: step1Result,
      step2: step2Result,
    };
  },
};

export const tools: IToolHandler[] = [searchThenReadTool];
