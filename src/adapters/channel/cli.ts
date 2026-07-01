/**
 * CLI 通道适配器 — 终端交互式对话（支持多会话并行）
 *
 * 命令：
 *   /conv list          列出会话（* 当前，~ 进行中）
 *   /conv new [标题]    新建并切换
 *   /conv use <id>      切换会话（进行中的请求不阻塞输入）
 *   /mode web|ide       切换模拟模式
 *   /quit               退出
 */

import * as readline from 'node:readline';
import type { IChannelAdapter, IInboundMessage, IOutboundMessage } from '../../ports/channel.js';
import { setCLISimulationMode, type CLISimulationMode } from '../../core/entry-prompt.js';

export interface ICLIAdapterOptions {
  channelName?: string;
  userId?: string;
  prompt?: string;
}

function parseUserFromArgs(): string | undefined {
  const idx = process.argv.indexOf('--user');
  if (idx >= 0 && idx + 1 < process.argv.length) {
    return process.argv[idx + 1]!.trim() || undefined;
  }
  return undefined;
}

function parseModeFromArgs(): CLISimulationMode {
  const idx = process.argv.indexOf('--mode');
  if (idx >= 0 && idx + 1 < process.argv.length) {
    const mode = process.argv[idx + 1]!.trim().toLowerCase();
    if (mode === 'web' || mode === 'ide') {
      return mode;
    }
    console.warn(`[PolarClaw] 未知模式 "${mode}"，使用默认 "ide"`);
  }
  return 'ide';
}

function newConvId(): string {
  return `cli_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

export function createCLIAdapter(options: ICLIAdapterOptions = {}): IChannelAdapter {
  const argUser = parseUserFromArgs();
  const mode = parseModeFromArgs();
  setCLISimulationMode(mode);

  const { channelName = 'cli', userId = argUser ?? 'admin', prompt = '你> ' } = options;
  let messageHandler: ((msg: IInboundMessage) => Promise<string>) | null = null;
  let rl: readline.Interface | null = null;
  let running = false;

  let activeConvId = newConvId();
  const convTitles = new Map<string, string>([[activeConvId, '默认']]);
  const pending = new Set<string>();

  function channelFor(convId: string): string {
    return `${channelName}:${convId}`;
  }

  function promptLabel(): string {
    const title = convTitles.get(activeConvId) ?? activeConvId;
    const mark = pending.has(activeConvId) ? '~' : '';
    return `[${title}${mark}]> `;
  }

  function listConversations(): void {
    console.log('\n会话列表：');
    for (const [id, title] of convTitles) {
      const cur = id === activeConvId ? '*' : ' ';
      const pend = pending.has(id) ? ' ~进行中' : '';
      console.log(`  ${cur} ${id.slice(0, 24).padEnd(24)} ${title}${pend}`);
    }
    console.log('');
  }

  return {
    name: channelName,

    async start() {
      if (running) return;
      running = true;

      rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: process.stdin.isTTY === true,
      });

      const modeLabel = mode === 'web' ? 'Web (产品经理)' : 'IDE (开发者)';

      console.log('');
      console.log('╭──────────────────────────────────────────╮');
      console.log('│  PolarClaw CLI — 多会话（/conv 管理）    │');
      console.log(`│  用户: ${userId.padEnd(33)}│`);
      console.log(`│  模式: ${modeLabel.padEnd(33)}│`);
      console.log('│  /conv list | /conv new | /conv use <id> │');
      console.log('│  /quit 退出                              │');
      console.log('╰──────────────────────────────────────────╯');
      console.log('');

      rl.on('close', () => {
        running = false;
      });

      const askNext = () => {
        if (!running || !rl) return;
        try {
          rl.question(promptLabel(), async (input) => {
            const text = input.trim();

            if (!text) {
              askNext();
              return;
            }

            if (text === '/quit' || text === '/exit' || text === '/q') {
              console.log('\n再见 👋');
              running = false;
              rl?.close();
              process.exit(0);
              return;
            }

            if (text.startsWith('/mode ')) {
              const newMode = text.slice(6).trim().toLowerCase();
              if (newMode === 'web' || newMode === 'ide') {
                setCLISimulationMode(newMode);
                const newLabel = newMode === 'web' ? 'Web (产品经理)' : 'IDE (开发者)';
                console.log(`\n[PolarClaw] 已切换到 ${newLabel} 模式\n`);
              } else {
                console.log('\n[PolarClaw] 无效模式，请使用 /mode web 或 /mode ide\n');
              }
              askNext();
              return;
            }

            if (text === '/conv' || text === '/conv list') {
              listConversations();
              askNext();
              return;
            }

            if (text.startsWith('/conv new')) {
              const title = text.slice(9).trim() || `会话${convTitles.size + 1}`;
              const id = newConvId();
              convTitles.set(id, title);
              activeConvId = id;
              console.log(`\n[PolarClaw] 新建并切换到 ${title} (${id})\n`);
              askNext();
              return;
            }

            if (text.startsWith('/conv use ')) {
              const id = text.slice(10).trim();
              const match = [...convTitles.keys()].find(k => k === id || k.startsWith(id));
              if (!match) {
                console.log('\n[PolarClaw] 未找到会话，/conv list 查看\n');
              } else {
                activeConvId = match;
                console.log(`\n[PolarClaw] 已切换到 ${convTitles.get(match)} (${match})\n`);
              }
              askNext();
              return;
            }

            if (!messageHandler) {
              console.log('[PolarClaw] 未注册消息处理器');
              askNext();
              return;
            }

            const convAtSend = activeConvId;
            const title = convTitles.get(convAtSend) ?? convAtSend;
            pending.add(convAtSend);
            console.log(`\n[${title}] 思考中…（可 /conv use 切换至其他会话）\n`);

            const inbound: IInboundMessage = {
              channel: channelFor(convAtSend),
              userId,
              text,
              timestamp: new Date(),
            };

            void messageHandler(inbound)
              .then((reply) => {
                console.log(`\n[${title}] PolarClaw> ${reply}\n`);
              })
              .catch((err) => {
                console.error(`\n[${title}] [Error] ${err instanceof Error ? err.message : String(err)}\n`);
              })
              .finally(() => {
                pending.delete(convAtSend);
              });

            askNext();
          });
        } catch {
          running = false;
        }
      };

      askNext();
    },

    async stop() {
      running = false;
      rl?.close();
      rl = null;
    },

    async send(message: IOutboundMessage) {
      console.log(`\nPolarClaw> ${message.text}\n`);
    },

    onMessage(handler) {
      messageHandler = handler;
    },
  };
}
