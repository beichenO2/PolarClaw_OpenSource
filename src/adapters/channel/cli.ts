/**
 * CLI 通道适配器 — 终端交互式对话
 *
 * 实现 IChannelAdapter 接口。
 * 通过 stdin/stdout 与用户交互，适用于本地开发测试。
 *
 * 支持 --mode 参数切换模拟模式：
 *   --mode web  模拟 Web Dashboard 入口（产品经理角色）
 *   --mode ide  模拟 IDE 入口（开发者角色，默认）
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

export function createCLIAdapter(options: ICLIAdapterOptions = {}): IChannelAdapter {
  const argUser = parseUserFromArgs();
  const mode = parseModeFromArgs();

  // 设置 CLI 模拟模式
  setCLISimulationMode(mode);

  const { channelName = 'cli', userId = argUser ?? 'admin', prompt = '你> ' } = options;
  let messageHandler: ((msg: IInboundMessage) => Promise<string>) | null = null;
  let rl: readline.Interface | null = null;
  let running = false;

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
      console.log('│  PolarClaw CLI — 输入消息开始对话        │');
      console.log(`│  用户: ${userId.padEnd(33)}│`);
      console.log(`│  模式: ${modeLabel.padEnd(33)}│`);
      console.log('│  输入 /quit 退出                         │');
      console.log('│  使用 --mode web/ide 切换模拟模式        │');
      console.log('╰──────────────────────────────────────────╯');
      console.log('');

      rl.on('close', () => {
        running = false;
      });

      const askNext = () => {
        if (!running || !rl) return;
        try {
          rl.question(prompt, async (input) => {
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

            // 支持运行时切换模式
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

            if (!messageHandler) {
              console.log('[PolarClaw] 未注册消息处理器');
              askNext();
              return;
            }

            const inbound: IInboundMessage = {
              channel: channelName,
              userId,
              text,
              timestamp: new Date(),
            };

            try {
              const reply = await messageHandler(inbound);
              console.log(`\nPolarClaw> ${reply}\n`);
            } catch (err) {
              console.error(`\n[Error] ${err instanceof Error ? err.message : String(err)}\n`);
            }

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
