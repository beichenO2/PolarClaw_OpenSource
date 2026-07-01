/**
 * @套辞 路由 — 飞书消息 → PolarUI taoci harness
 */

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const TAOCI_PATTERN = /@套辞/;
const DEFAULT_BOT = 'PolarClaw_Rr';

export function isTaociTrigger(text: string): boolean {
  return TAOCI_PATTERN.test(text ?? '');
}

export function stripTaociTrigger(text: string): string {
  return (text ?? '').replace(TAOCI_PATTERN, '').trim();
}

export function buildTaociConversationId(channel: string, userId: string): string {
  const safe = `${channel}:${userId}`.replace(/[^a-zA-Z0-9:_-]/g, '_');
  return `taoci-${safe}`;
}

export interface ITaociRouteInput {
  channel: string;
  userId: string;
  text: string;
  openId?: string;
  files?: string[];
  polarUiRoot?: string;
}

export interface ITaociRouteResult {
  routed: boolean;
  reply?: string;
  pdfPath?: string | null;
}

/** 调用 PolarUI harness（同步 spawn，供 PolarClaw 通道使用） */
export function runTaociHarness(
  polarUiRoot: string,
  conversationId: string,
  message: string,
  files: string[] = [],
): Record<string, unknown> {
  const harness = join(polarUiRoot, 'workflows', 'taoci-outreach', 'harness', 'index.mjs');
  const args = [harness, '--conversation-id', conversationId, '--message', message];
  if (files.length) args.push('--files', files.join(','));

  const r = spawnSync('node', args, {
    cwd: polarUiRoot,
    encoding: 'utf8',
    timeout: 300_000,
    env: { ...process.env, TAOCI_USE_CLAUDE_CLI: '0' },
  });

  const stdout = (r.stdout ?? '').trim();
  const lastLine = stdout.split('\n').filter(Boolean).pop() ?? stdout;
  try {
    return JSON.parse(lastLine) as Record<string, unknown>;
  } catch {
    return { ok: false, error: r.stderr || stdout || 'harness parse error' };
  }
}

export function tryTaociRoute(input: ITaociRouteInput): ITaociRouteResult {
  if (!isTaociTrigger(input.text)) {
    return { routed: false };
  }

  const home = process.env.HOME ?? '~';
  const polarUiRoot = input.polarUiRoot ?? join(home, 'Polarisor', 'PolarUI');
  const openId = input.openId ?? input.userId;
  const convId = buildTaociConversationId(input.channel, openId);
  const message = stripTaociTrigger(input.text) || input.text;

  const result = runTaociHarness(polarUiRoot, convId, message, input.files ?? []);
  const reply = String(result.reply ?? result.error ?? '处理完成');
  const pdfPath = (result.pdf_path as string | null | undefined) ?? null;

  return { routed: true, reply, pdfPath };
}

export const TAOCI_BOT_NAME = DEFAULT_BOT;
