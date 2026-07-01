/**
 * ComputerUse — 浏览器自动化技能工具
 *
 * 真正的 Safari 调用集中在 src/sdk/computer-use.ts；本文件只是
 * 把 SDK 函数包装成 ReAct ToolHandler 暴露给 PolarClaw 的 Agent 循环，
 * 这样 ReAct 工具调用与外部项目通过 polarclaw-project-sdk 的远程
 * 调用走完全相同的代码路径，行为不会漂移。
 *
 * Skill loader 通过 tsx 动态加载本文件；动态 require src/sdk 让该 import
 * 既能在 dev (npm run dev) 也能在 prod (node dist/main.js) 下解析到
 * 工程内唯一的实现源（dist/sdk/computer-use.js 优先，fallback 到 src/）。
 */

import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';

interface IToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

type ComputerUseModule = typeof import('../../src/sdk/computer-use.js');

let cachedModule: ComputerUseModule | null = null;

async function loadModule(): Promise<ComputerUseModule> {
  if (cachedModule) return cachedModule;

  const polarClawRoot = resolve(homedir(), 'Polarisor/PolarClaw');
  const distPath = resolve(polarClawRoot, 'dist/sdk/computer-use.js');
  const srcPath = resolve(polarClawRoot, 'src/sdk/computer-use.ts');
  const target = existsSync(distPath) ? distPath : srcPath;
  cachedModule = (await import(target)) as ComputerUseModule;
  return cachedModule;
}

export const browse_and_act: IToolHandler = {
  name: 'computer_use_browse',
  description: '使用浏览器导航到指定 URL 并执行自然语言描述的操作（点击、填写、滚动等）。返回操作结果和页面状态。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '目标网页 URL' },
      action: { type: 'string', description: '要执行的操作（自然语言描述）' },
      screenshot: { type: 'boolean', description: '操作完成后是否截图（默认 true）' },
    },
    required: ['url', 'action'],
  },

  async handler(args: Record<string, unknown>) {
    const mod = await loadModule();
    return mod.browse({
      url: String(args.url ?? ''),
      action: String(args.action ?? ''),
      screenshot: args.screenshot !== false,
    });
  },
};

export const screenshot_and_analyze: IToolHandler = {
  name: 'computer_use_screenshot',
  description: '截取指定 URL 的页面截图。可配合 VLM 视觉模型分析 UI 质量和布局。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '目标网页 URL' },
      full_page: { type: 'boolean', description: '是否截取完整页面（默认 false）' },
      observe: { type: 'boolean', description: '是否同时返回页面可交互元素列表（默认 false）' },
    },
    required: ['url'],
  },

  async handler(args: Record<string, unknown>) {
    const mod = await loadModule();
    return mod.screenshot({
      url: String(args.url ?? ''),
      full_page: Boolean(args.full_page),
      observe: Boolean(args.observe),
    });
  },
};

export const fill_form: IToolHandler = {
  name: 'computer_use_fill_form',
  description: '在指定页面上填写表单。接受字段描述到值的映射，自动定位并填写。',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string', description: '表单页面 URL' },
      fields: {
        type: 'object',
        description: '表单字段映射，key 是字段描述（如"用户名"、"邮箱"），value 是要填写的值',
        additionalProperties: { type: 'string' },
      },
      submit: { type: 'boolean', description: '填写完后是否提交表单（默认 false）' },
    },
    required: ['url', 'fields'],
  },

  async handler(args: Record<string, unknown>) {
    const mod = await loadModule();
    return mod.fillForm({
      url: String(args.url ?? ''),
      fields: (args.fields as Record<string, string> | undefined) ?? {},
      submit: Boolean(args.submit),
    });
  },
};

export default [browse_and_act, screenshot_and_analyze, fill_form];
