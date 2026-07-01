/**
 * 从 PolarPrivate d-class grant 注入飞书 Bot 凭证到 process.env
 *
 * feishu.admin.*  → FEISHU_ADMIN_*
 * feishu.rr.*     → FEISHU_RR_*（PolarClaw_Rr / @套辞）
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { execPath } from 'node:process';

const SECRET_TO_ENV: Record<string, string> = {
  'feishu.admin.app_id': 'FEISHU_ADMIN_APP_ID',
  'feishu.admin.app_secret': 'FEISHU_ADMIN_APP_SECRET',
  'feishu.admin.verification_token': 'FEISHU_ADMIN_VERIFICATION_TOKEN',
  'feishu.admin.encrypt_key': 'FEISHU_ADMIN_ENCRYPT_KEY',
  'feishu.rr.app_id': 'FEISHU_RR_APP_ID',
  'feishu.rr.app_secret': 'FEISHU_RR_APP_SECRET',
  'feishu.rr.verification_token': 'FEISHU_RR_VERIFICATION_TOKEN',
  'feishu.rr.encrypt_key': 'FEISHU_RR_ENCRYPT_KEY',
};

const SERVICE_PREFIXES: { service: string; envPrefix: string; requiredKeys: string[] }[] = [
  {
    service: 'feishu-admin',
    envPrefix: 'FEISHU_ADMIN',
    requiredKeys: ['feishu.admin.app_id', 'feishu.admin.app_secret', 'feishu.admin.verification_token'],
  },
  {
    service: 'feishu-rr',
    envPrefix: 'FEISHU_RR',
    requiredKeys: ['feishu.rr.app_id', 'feishu.rr.app_secret', 'feishu.rr.verification_token'],
  },
];

function callerSha256(): string {
  return createHash('sha256').update(readFileSync(execPath)).digest('hex');
}

function isPlaceholder(v: string): boolean {
  const s = v.trim();
  return !s || s === 'PLACEHOLDER' || s.startsWith('your_') || s === 'cli_test_id';
}

async function grantSecrets(
  baseUrl: string,
  serviceName: string,
): Promise<Record<string, string>> {
  const res = await fetch(`${baseUrl}/api/d-class/grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      service_name: serviceName,
      caller_executable_sha256: callerSha256(),
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return {};
  const data = (await res.json()) as { secrets?: Record<string, string> };
  return data.secrets ?? {};
}

function applySecrets(secrets: Record<string, string>, onlyIfUnset: boolean): number {
  let n = 0;
  for (const [secretKey, envKey] of Object.entries(SECRET_TO_ENV)) {
    const val = secrets[secretKey];
    if (!val || isPlaceholder(val)) continue;
    if (onlyIfUnset && (process.env[envKey] ?? '').trim()) continue;
    process.env[envKey] = val.trim();
    n += 1;
  }
  return n;
}

/** 从 PolarPrivate 注入飞书 env；返回注入的变量数量 */
export async function loadFeishuEnvFromPolarPrivate(
  baseUrl = process.env.POLARPRIVATE_URL?.trim() || 'http://127.0.0.1:12790',
): Promise<{ injected: number; services: string[] }> {
  const services: string[] = [];
  let injected = 0;

  for (const { service, envPrefix, requiredKeys } of SERVICE_PREFIXES) {
    const already = requiredKeys.every(k => {
      const envKey = SECRET_TO_ENV[k];
      return envKey && (process.env[envKey] ?? '').trim() && !isPlaceholder(process.env[envKey]!);
    });
    if (already) continue;

    const secrets = await grantSecrets(baseUrl, service);
    if (!Object.keys(secrets).length) continue;

    const ok = requiredKeys.every(k => secrets[k] && !isPlaceholder(secrets[k]));
    if (!ok) {
      console.error(`[feishu-env] ${service}: PolarPrivate 凭证缺失或为 PLACEHOLDER，请在 UI 填写 feishu.rr.* 等 Secret`);
      continue;
    }

    injected += applySecrets(secrets, true);
    services.push(service);
  }

  if (injected > 0) {
    console.error(`[feishu-env] 已从 PolarPrivate 注入 ${injected} 个 FEISHU_* 变量 (${services.join(', ')})`);
  }

  return { injected, services };
}

export function validateFeishuBootstrap(): void {
  for (const { envPrefix } of SERVICE_PREFIXES) {
    if (!(process.env[`${envPrefix}_APP_ID`] ?? '').trim()) continue;
    const pre = [`${envPrefix}_APP_ID`, `${envPrefix}_APP_SECRET`, `${envPrefix}_VERIFICATION_TOKEN`];
    const missing = pre.filter(k => !(process.env[k] ?? '').trim());
    if (missing.length) {
      console.error(`[feishu-env] ${envPrefix}: 缺少 ${missing.join(', ')}`);
    }
  }
}
