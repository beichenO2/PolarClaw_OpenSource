/**
 * 飞书 Bot 配置加载器
 *
 * 从环境变量加载飞书应用凭证。
 * 凭证通常由 PolarPrivate secrets-loader 注入到 process.env。
 *
 * 环境变量名沿用旧版的 SECRET_TO_ENV 映射：
 *   feishu.admin.app_id → FEISHU_ADMIN_APP_ID
 *   等等
 */

export type FeishuDomain = 'feishu' | 'lark';

export interface IFeishuBotConfig {
  appId: string;
  appSecret: string;
  encryptKey: string;
  verificationToken: string;
  domain: FeishuDomain;
  /** 允许接收消息的 open_id 白名单（空 = 不限制） */
  allowFrom: Set<string>;
  webhookHost: string;
  webhookPort: number;
  webhookPath: string;
}

/**
 * 预检飞书环境变量是否就位，纯函数，不抛错
 * @param prefix 环境变量前缀，如 "FEISHU_ADMIN" 或 "FEISHU_GIRLFRIEND"
 */
export function validateFeishuEnv(
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): { missing: string[]; present: string[] } {
  const p = prefix.toUpperCase();
  const required = [`${p}_APP_ID`, `${p}_APP_SECRET`, `${p}_VERIFICATION_TOKEN`];
  const optional = [
    `${p}_ENCRYPT_KEY`,
    `${p}_WEBHOOK_HOST`,
    `${p}_WEBHOOK_PORT`,
    `${p}_WEBHOOK_PATH`,
    `${p}_ALLOW_FROM`,
  ];

  const missing: string[] = [];
  const present: string[] = [];

  for (const key of required) {
    if ((env[key] ?? '').trim()) {
      present.push(key);
    } else {
      missing.push(key);
    }
  }
  for (const key of optional) {
    if ((env[key] ?? '').trim()) {
      present.push(key);
    }
  }

  return { missing, present };
}

/**
 * 从环境变量加载飞书 Bot 配置
 * @param prefix 环境变量前缀，如 "FEISHU_ADMIN" 或 "FEISHU_GIRLFRIEND"
 */
export function loadFeishuConfig(
  prefix: string,
  env: NodeJS.ProcessEnv = process.env,
): IFeishuBotConfig {
  const p = prefix.toUpperCase();

  const appId = (env[`${p}_APP_ID`] ?? '').trim();
  if (!appId) throw new Error(`${p}_APP_ID is required`);

  const appSecret = (env[`${p}_APP_SECRET`] ?? '').trim();
  if (!appSecret) throw new Error(`${p}_APP_SECRET is required`);

  const verificationToken = (env[`${p}_VERIFICATION_TOKEN`] ?? '').trim();
  if (!verificationToken) throw new Error(`${p}_VERIFICATION_TOKEN is required`);

  const encryptKey = (env[`${p}_ENCRYPT_KEY`] ?? '').trim();

  const domainRaw = (env.FEISHU_DOMAIN ?? 'feishu').trim().toLowerCase();
  let domain: FeishuDomain = 'feishu';
  if (domainRaw === 'lark') domain = 'lark';

  const allowRaw = (env[`${p}_ALLOW_FROM`] ?? '').trim();
  const allowFrom = new Set(
    allowRaw ? allowRaw.split(',').map(s => s.trim()).filter(Boolean) : [],
  );

  const webhookHost = (env[`${p}_WEBHOOK_HOST`] ?? '127.0.0.1').trim() || '127.0.0.1';
  const portRaw = (env[`${p}_WEBHOOK_PORT`] ?? '3000').trim();
  const webhookPort = Number(portRaw);
  if (!Number.isFinite(webhookPort) || webhookPort < 1 || webhookPort > 65535) {
    throw new Error(`${p}_WEBHOOK_PORT must be a valid TCP port`);
  }

  const webhookPath = (env[`${p}_WEBHOOK_PATH`] ?? '/feishu/events').trim();
  if (!webhookPath.startsWith('/')) {
    throw new Error(`${p}_WEBHOOK_PATH must start with /`);
  }

  return {
    appId,
    appSecret,
    encryptKey,
    verificationToken,
    domain,
    allowFrom,
    webhookHost,
    webhookPort,
    webhookPath,
  };
}
