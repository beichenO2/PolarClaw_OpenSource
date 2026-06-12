import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

interface IToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

const POLARISOR_ROOT = resolve(homedir(), 'Polarisor');
const MAX_OUTPUT = 50 * 1024;
const DEFAULT_TIMEOUT = 120000;

const BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\//,
  /\bshutdown\b/,
  /\breboot\b/,
];

function validateCommand(cmd: string): void {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      throw new Error(`命令被安全策略阻止: ${cmd.slice(0, 80)}`);
    }
  }
}

function validateWorkDir(dir: string): string {
  const resolved = resolve(dir);
  if (!resolved.startsWith(POLARISOR_ROOT) && !resolved.startsWith('/tmp/')) {
    throw new Error(`工作目录必须在 ~/Polarisor/ 或 /tmp/ 下: ${resolved}`);
  }
  if (!existsSync(resolved)) {
    throw new Error(`工作目录不存在: ${resolved}`);
  }
  return resolved;
}

export const tools: IToolHandler[] = [
  {
    name: 'shell_exec',
    description: '在指定目录下执行一条 shell 命令。适用于调用 MATLAB、Python、ffmpeg 等 CLI 工具处理数据。工作目录限制在 ~/Polarisor/ 范围内。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        cwd: { type: 'string', description: '工作目录（必须在 ~/Polarisor/ 下，默认 ~/Polarisor）' },
        timeout_seconds: { type: 'number', description: '超时秒数（默认 120）' },
      },
      required: ['command'],
    },
    async handler(args) {
      const command = String(args.command);
      const cwd = validateWorkDir(String(args.cwd || POLARISOR_ROOT));
      const timeoutMs = Math.min(
        (Number(args.timeout_seconds) || 120) * 1000,
        600000,
      );

      validateCommand(command);

      const start = Date.now();
      let stdout = '';
      let stderr = '';
      let exitCode = 0;

      try {
        stdout = execSync(command, {
          cwd,
          encoding: 'utf8',
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT,
          env: { ...process.env, HOME: homedir() },
          shell: '/bin/bash',
        });
      } catch (err: unknown) {
        const execErr = err as { status?: number; stdout?: string; stderr?: string; message?: string };
        exitCode = execErr.status ?? 1;
        stdout = execErr.stdout ?? '';
        stderr = execErr.stderr ?? execErr.message ?? String(err);
      }

      const elapsed = Date.now() - start;

      if (stdout.length > MAX_OUTPUT) {
        stdout = stdout.slice(0, MAX_OUTPUT) + '\n...(输出已截断)';
      }
      if (stderr.length > MAX_OUTPUT) {
        stderr = stderr.slice(0, MAX_OUTPUT) + '\n...(输出已截断)';
      }

      return {
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        elapsedMs: elapsed,
        cwd,
      };
    },
  },
];
