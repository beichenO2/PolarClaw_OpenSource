/**
 * PolarClaw 配置加载器
 *
 * 从环境变量加载配置，支持 .env 文件。
 * 环境变量使用 POLARCLAW_* 前缀。
 */

import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

export interface IPolarClawConfig {
  projectRoot: string;
  llm: {
    temperature: number;
    maxTokens: number;
    maxToolRounds: number;
    requestTimeoutMs: number;
    concurrencyLimit: number;
  };
  memory: {
    dbPath: string;
    maxMessages: number;
    maxTokens: number;
  };
  privacy: {
    polarPrivateUrl: string;
    enableSecretInterception: boolean;
  };
  channels: {
    feishu: boolean;
    cli: boolean;
  };
  skills: {
    scanDirs: string[];
  };
}

/** 最简 .env 解析器 */
function loadEnvFile(filePath: string): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, 'utf8');
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!key || Object.hasOwn(process.env, key)) continue;
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

/**
 * 在 secrets loader 之前预加载 .env，确保 POLARPRIVATE_URL 等基础配置可用。
 * 幂等：loadConfig 内部再次调用 loadEnvFile 不会覆盖已有值。
 */
export function loadEnvFileEarly(): void {
  loadEnvFile(join(ROOT, '.env'));
}

function env(key: string, fallback = ''): string {
  return process.env[key]?.trim() ?? fallback;
}

function pcEnv(suffix: string, fallback = ''): string {
  return process.env[`POLARCLAW_${suffix}`]?.trim() ?? fallback;
}

export function loadConfig(): IPolarClawConfig {
  loadEnvFile(join(ROOT, '.env'));

  const config: IPolarClawConfig = {
    projectRoot: ROOT,
    llm: {
      temperature: Number(pcEnv('TEMPERATURE', '0.7')),
      maxTokens: Number(pcEnv('MAX_TOKENS', '4096')),
      maxToolRounds: Number(pcEnv('MAX_TOOL_ROUNDS', '15')),
      requestTimeoutMs: Number(pcEnv('LLM_TIMEOUT_MS', '300000')),
      concurrencyLimit: Number(pcEnv('LLM_CONCURRENCY', '5')),
    },
    memory: {
      dbPath: pcEnv('DB_PATH', join(ROOT, '.data', 'polarclaw.db')),
      maxMessages: Number(pcEnv('MAX_MESSAGES', '100')),
      maxTokens: Number(pcEnv('CONVERSATION_MAX_TOKENS', '60000')),
    },
    privacy: {
      polarPrivateUrl: env('POLARPRIVATE_URL', 'http://127.0.0.1:12790'),
      enableSecretInterception: pcEnv('SECRET_INTERCEPTION', 'true') === 'true',
    },
    channels: {
      feishu: pcEnv('FEISHU', '0') === '1',
      cli: pcEnv('CLI', '0') === '1',
    },
    skills: {
      scanDirs: [join(ROOT, 'PolarSkills')],
    },
  };

  // Runtime validation
  const numericChecks: [string, number][] = [
    ['llm.temperature', config.llm.temperature],
    ['llm.maxTokens', config.llm.maxTokens],
    ['llm.maxToolRounds', config.llm.maxToolRounds],
    ['llm.requestTimeoutMs', config.llm.requestTimeoutMs],
    ['memory.maxMessages', config.memory.maxMessages],
    ['memory.maxTokens', config.memory.maxTokens],
  ];
  for (const [name, value] of numericChecks) {
    if (Number.isNaN(value)) {
      throw new Error(`Invalid config: ${name} is NaN — check the corresponding environment variable`);
    }
  }
  if (config.llm.temperature < 0 || config.llm.temperature > 2) {
    throw new Error(`Invalid config: llm.temperature must be 0–2, got ${config.llm.temperature}`);
  }
  if (config.llm.maxToolRounds < 0) {
    throw new Error(`Invalid config: llm.maxToolRounds must be >= 0 (0 = unlimited), got ${config.llm.maxToolRounds}`);
  }

  return config;
}
