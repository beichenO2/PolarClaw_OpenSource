/**
 * SDK computer-use module — Safari-backed browser automation (macOS).
 *
 * Uses the user's logged-in Safari session via AppleScript. No Chrome / Chromium /
 * Playwright / Stagehand. Other Polarisor projects call this through polarclaw-project-sdk.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import {
  safariFillFields,
  safariRunJs,
  safariSnapshot,
  safariSubmitForm,
} from './safari-browser.js';

const SNAPSHOT_DIR = resolve(homedir(), 'Polarisor/PolarClaw/data/screenshots');

function ensureSnapshotDir(): void {
  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

function envOr(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : fallback;
}

const VLM_URL = envOr('COMPUTER_USE_VLM_URL', 'http://localhost:11434/v1');
const VLM_MODEL = envOr('COMPUTER_USE_VLM_MODEL', 'qwen3-vl:8b');

const VLM_DEFAULT_PROMPT =
  '请分析以下网页文本内容。描述主要内容、布局结构、可见交互元素及其状态。用中文回答。';

async function analyzeWithVLM(text: string, prompt?: string): Promise<string> {
  const body = {
    model: VLM_MODEL,
    messages: [
      {
        role: 'user',
        content: `${prompt || VLM_DEFAULT_PROMPT}\n\n---\n${text.slice(0, 8000)}`,
      },
    ],
    max_tokens: 2000,
    temperature: 0.3,
    stream: false,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(`${VLM_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`VLM ${res.status}: ${errText.slice(0, 300)}`);
    }
    const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content?.trim() ?? '(VLM 无输出)';
  } finally {
    clearTimeout(timer);
  }
}

export interface ComputerUseBrowseInput {
  url: string;
  action: string;
  screenshot?: boolean;
}

export interface ComputerUseBrowseResult {
  ok: boolean;
  action_result?: { success: boolean; message?: string };
  page_url?: string;
  page_title?: string;
  page_text?: string;
  snapshot?: string;
  error?: string;
}

export interface ComputerUseScreenshotInput {
  url: string;
  full_page?: boolean;
  observe?: boolean;
  observe_timeout_ms?: number;
  analyze?: boolean;
  analyze_prompt?: string;
}

export interface ComputerUseScreenshotResult {
  ok: boolean;
  snapshot?: string;
  page_url?: string;
  page_title?: string;
  page_text?: string;
  elements?: Array<{ description?: string; selector?: string }>;
  analysis?: string;
  error?: string;
}

export interface ComputerUseFillFormInput {
  url: string;
  fields: Record<string, string>;
  submit?: boolean;
}

export interface ComputerUseFillFormResult {
  ok: boolean;
  results?: Array<{ field: string; success: boolean; message?: string }>;
  page_url?: string;
  snapshot?: string;
  error?: string;
}

function saveTextSnapshot(prefix: string, text: string): string {
  ensureSnapshotDir();
  const path = join(SNAPSHOT_DIR, `${prefix}-${Date.now()}.txt`);
  writeFileSync(path, text, 'utf8');
  return path;
}

export async function browse(input: ComputerUseBrowseInput): Promise<ComputerUseBrowseResult> {
  const url = (input.url ?? '').toString();
  const action = (input.action ?? '').toString();
  if (!url || !action) {
    return { ok: false, error: 'url 和 action 都是必填' };
  }

  try {
    const page = await safariSnapshot(url);
    const actionJs = `
(function() {
  try {
    ${action.includes(';') || action.includes('document.') || action.includes('querySelector')
      ? action
      : `/* natural-language action — return page context */ return ${JSON.stringify(action)};`}
  } catch (e) { return String(e); }
})()
`.trim();

    let actionMessage = action;
    try {
      const actionRaw = await safariRunJs(url, actionJs, { delaySec: 4 });
      actionMessage = actionRaw.slice(0, 500);
    } catch {
      actionMessage = `已加载页面；action 未执行 JS：${action.slice(0, 200)}`;
    }

    const snapshotPath = input.screenshot !== false
      ? saveTextSnapshot('cu-browse', page.text)
      : undefined;

    return {
      ok: true,
      action_result: { success: true, message: actionMessage },
      page_url: page.url,
      page_title: page.title,
      page_text: page.text,
      snapshot: snapshotPath,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function screenshot(input: ComputerUseScreenshotInput): Promise<ComputerUseScreenshotResult> {
  const url = (input.url ?? '').toString();
  if (!url) return { ok: false, error: 'url 必填' };

  try {
    const page = await safariSnapshot(url);
    const snapshotPath = saveTextSnapshot('cu-screenshot', page.text);

    let analysis: string | undefined;
    if (input.analyze) {
      try {
        analysis = await analyzeWithVLM(page.text, input.analyze_prompt);
      } catch (err) {
        analysis = `[VLM error: ${err instanceof Error ? err.message : String(err)}]`;
      }
    }

    const elements = input.observe
      ? [{ description: page.text.slice(0, 500), selector: 'document.body' }]
      : undefined;

    return {
      ok: true,
      snapshot: snapshotPath,
      page_url: page.url,
      page_title: page.title,
      page_text: page.text,
      elements,
      analysis,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fillForm(input: ComputerUseFillFormInput): Promise<ComputerUseFillFormResult> {
  const url = (input.url ?? '').toString();
  const fields = input.fields;
  if (!url || !fields || typeof fields !== 'object') {
    return { ok: false, error: 'url 和 fields 都是必填' };
  }

  try {
    const results = await safariFillFields(url, fields);
    if (input.submit) {
      const submit = await safariSubmitForm(url);
      results.push({
        field: '__submit__',
        success: submit.success,
        message: submit.message,
      });
    }
    const page = await safariSnapshot(url);
    const snapshotPath = saveTextSnapshot('cu-form', page.text);
    return {
      ok: true,
      results,
      page_url: page.url,
      snapshot: snapshotPath,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function createComputerUseModule() {
  return { browse, screenshot, fillForm };
}

export type ComputerUseModule = ReturnType<typeof createComputerUseModule>;
