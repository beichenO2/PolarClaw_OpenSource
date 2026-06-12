/**
 * 飞书通道适配器
 *
 * 实现 IChannelAdapter 接口，桥接飞书消息与 Agent 核心循环。
 * 支持两种传输方式：
 *   1. WebSocket（推荐，无需公网 IP）
 *   2. Webhook HTTP Server（需要飞书后台配置回调地址）
 *
 * 依赖 @larksuiteoapi/node-sdk 官方 SDK。
 */

import * as http from 'node:http';
import crypto from 'node:crypto';
import * as Lark from '@larksuiteoapi/node-sdk';
import type { IAttachment, IChannelAdapter, IInboundMessage, IOutboundMessage } from '../../ports/channel.js';
import type { IFeishuBotConfig } from './feishu-config.js';
import type { IFeishuDedup } from './feishu-dedup.js';

export interface IFeishuAdapterOptions {
  config: IFeishuBotConfig;
  /** 传输方式，默认 websocket */
  transport?: 'websocket' | 'webhook';
  /** 通道名称标识（如 "feishu:admin" 或 "feishu:girlfriend"） */
  channelName?: string;
  /** 消息去重实例（可选，启用后自动过滤重复 + 启动补漏） */
  dedup?: IFeishuDedup;
  /** 消息聚合窗口 ms（同一用户连续消息在窗口内合并为一条）。0 = 关闭。默认 3000 */
  debounceMs?: number;
  /** 接收到文件时的本地存放根目录（默认 ~/Polarisor/macbook） */
  fileReceiveRoot?: string;
  /** PolarPrivate 用户解析函数（可选，启用后将飞书 openId 映射为 Polarisor userId） */
  resolveUser?: (openId: string) => Promise<{ user_id: string; username: string } | null>;
}

function resolveSdkDomain(config: IFeishuBotConfig) {
  return config.domain === 'lark' ? Lark.Domain.Lark : Lark.Domain.Feishu;
}

/** 飞书 Webhook 签名验证 */
function verifySignature(
  headers: http.IncomingHttpHeaders,
  rawBody: string,
  encryptKey?: string,
): boolean {
  if (!encryptKey?.trim()) return true;

  const timestamp = headers['x-lark-request-timestamp'] as string | undefined;
  const nonce = headers['x-lark-request-nonce'] as string | undefined;
  const signature = headers['x-lark-signature'] as string | undefined;
  if (!timestamp || !nonce || !signature) return false;

  const computed = crypto
    .createHash('sha256')
    .update(timestamp + nonce + encryptKey + rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, 'utf8'),
      Buffer.from(signature, 'utf8'),
    );
  } catch {
    return false;
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

/** 从飞书 post 富文本中提取纯文本 */
function postToPlainText(post: Record<string, unknown>): string {
  const node = isRecord(post.zh_cn) ? post.zh_cn : isRecord(post.en_us) ? post.en_us : null;
  const content = node && Array.isArray(node.content) ? node.content : null;
  if (!content) return '';

  const parts: string[] = [];
  for (const row of content) {
    if (!Array.isArray(row)) continue;
    for (const seg of row) {
      if (isRecord(seg) && seg.tag === 'text' && typeof seg.text === 'string') {
        parts.push(seg.text);
      }
    }
  }
  return parts.join('').trim();
}

function parseJsonContent(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export interface IFeishuAdapterHealth {
  isAlive(): boolean;
  getLastEventTime(): string | null;
  getLastError(): { code: string; message: string } | null;
}

export type IFeishuChannelAdapter = IChannelAdapter & IFeishuAdapterHealth;

export function createFeishuAdapter(options: IFeishuAdapterOptions): IFeishuChannelAdapter {
  const {
    config,
    transport = 'websocket',
    channelName = 'feishu',
    dedup,
    debounceMs = 3000,
    fileReceiveRoot,
    resolveUser,
  } = options;
  let messageHandler: ((msg: IInboundMessage) => Promise<string>) | null = null;

  const client = new Lark.Client({
    appId: config.appId,
    appSecret: config.appSecret,
    appType: Lark.AppType.SelfBuild,
    domain: resolveSdkDomain(config),
  });

  const dispatcher = new Lark.EventDispatcher({
    encryptKey: config.encryptKey || undefined,
    verificationToken: config.verificationToken || undefined,
  });

  let wsClient: Lark.WSClient | null = null;
  let httpServer: http.Server | null = null;

  // ─── Health State ──────────────────────────────────────────────────────
  let alive = false;
  let lastEventAt: number | null = null;
  let lastError: { code: string; message: string } | null = null;

  // ─── Message Aggregation Buffer ───────────────────────────────────────
  interface PendingMsg {
    messageId: string;
    text: string;
    createTime?: string;
    attachments?: IAttachment[];
  }
  interface PendingBatch {
    chatId: string;
    openId: string | undefined;
    messages: PendingMsg[];
    timer: ReturnType<typeof setTimeout>;
  }
  const pendingBatches = new Map<string, PendingBatch>();

  function enqueueMessage(
    chatId: string,
    messageId: string,
    openId: string | undefined,
    text: string,
    createTime?: string,
    attachments?: IAttachment[],
  ) {
    if (dedup?.isProcessed(messageId)) return;

    if (debounceMs <= 0) {
      void dispatchSingle(chatId, messageId, openId, text, createTime, attachments);
      return;
    }

    const key = `${chatId}:${openId ?? chatId}`;
    const existing = pendingBatches.get(key);

    if (existing) {
      clearTimeout(existing.timer);
      existing.messages.push({ messageId, text, createTime, attachments });
    } else {
      pendingBatches.set(key, {
        chatId,
        openId,
        messages: [{ messageId, text, createTime, attachments }],
        timer: undefined as unknown as ReturnType<typeof setTimeout>,
      });
    }

    const batch = pendingBatches.get(key)!;
    batch.timer = setTimeout(() => void flushBatch(key), debounceMs);
  }

  async function flushBatch(key: string) {
    const batch = pendingBatches.get(key);
    if (!batch || batch.messages.length === 0) return;
    pendingBatches.delete(key);

    const mergedText = batch.messages.map(m => m.text).filter(Boolean).join('\n');
    const allAttachments = batch.messages.flatMap(m => m.attachments ?? []);
    const lastMsg = batch.messages[batch.messages.length - 1]!;

    if (batch.messages.length > 1) {
      console.error(`[${channelName}] 聚合 ${batch.messages.length} 条消息 → 1 条`);
    }

    for (const m of batch.messages) {
      dedup?.markProcessed(m.messageId, m.createTime);
    }

    await dispatchSingle(
      batch.chatId,
      lastMsg.messageId,
      batch.openId,
      mergedText,
      lastMsg.createTime,
      allAttachments.length > 0 ? allAttachments : undefined,
    );
  }

  /** Process a single (possibly aggregated) message */
  async function dispatchSingle(
    chatId: string,
    messageId: string,
    openId: string | undefined,
    text: string,
    createTime?: string,
    attachments?: IAttachment[],
  ) {
    if (!messageHandler || (!text && !attachments?.length)) return;
    lastEventAt = Date.now();

    let resolvedUserId = openId ?? chatId;
    if (resolveUser && openId) {
      try {
        const resolved = await resolveUser(openId);
        if (resolved) {
          resolvedUserId = resolved.user_id;
        }
      } catch (err) {
        console.error(`[${channelName}] resolveUser failed for ${openId}:`, err);
      }
    }

    const inbound: IInboundMessage = {
      channel: channelName,
      userId: resolvedUserId,
      text: text || '',
      attachments,
      timestamp: new Date(),
      metadata: { chatId, messageId, openId, resolvedUserId },
    };

    try {
      const reply = await messageHandler(inbound);
      await client.im.message.reply({
        path: { message_id: messageId },
        data: {
          msg_type: 'text',
          content: JSON.stringify({ text: reply }),
        },
      });
      dedup?.markProcessed(messageId, createTime);
    } catch (err) {
      console.error(`[${channelName}] dispatchSingle error:`, err);
      dedup?.markProcessed(messageId, createTime);
    }
  }

  // ─── File Download ────────────────────────────────────────────────────
  async function downloadFeishuFile(
    messageId: string,
    fileKey: string,
    fileName: string | undefined,
    fileType: 'image' | 'file',
    userId?: string,
  ): Promise<IAttachment | null> {
    try {
      const { existsSync: fsExists, mkdirSync, writeFileSync } = await import('node:fs');
      const { join, resolve: pathResolve } = await import('node:path');
      const { homedir } = await import('node:os');

      const root = fileReceiveRoot ?? join(homedir(), 'Polarisor', 'macbook');
      const userDir = userId || 'unresolved';
      const inboxDir = join(root, '_feishu_inbox', userDir);
      if (!fsExists(inboxDir)) mkdirSync(inboxDir, { recursive: true });

      const safeName = fileName?.replace(/[/\\:*?"<>|]/g, '_') ?? `${fileKey}.dat`;
      const localPath = pathResolve(inboxDir, `${Date.now()}_${safeName}`);

      const res = await client.im.messageResource.get({
        path: { message_id: messageId, file_key: fileKey },
        params: { type: fileType },
      });

      if (res && typeof (res as any).writeFile === 'function') {
        await (res as any).writeFile(localPath);
      } else {
        const stream = (res as any)?.getReadableStream?.();
        if (stream) {
          const chunks: Buffer[] = [];
          for await (const chunk of stream as AsyncIterable<Buffer>) {
            chunks.push(chunk);
          }
          writeFileSync(localPath, Buffer.concat(chunks));
        } else {
          console.error(`[${channelName}] ${fileType}下载无数据: ${fileKey}`);
          return null;
        }
      }

      console.error(`[${channelName}] 文件已下载: ${localPath}`);
      return {
        type: fileType,
        url: `file://${localPath}`,
        filename: safeName,
      };
    } catch (err) {
      console.error(`[${channelName}] 文件下载失败 (${fileKey}):`, err);
      return null;
    }
  }

  /** 自动获取 Bot 所在的所有会话 */
  async function discoverChatIds(): Promise<string[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    try {
      do {
        const res = await client.im.chat.list({
          params: { page_size: 100, ...(pageToken && { page_token: pageToken }) },
        });
        for (const chat of res?.data?.items ?? []) {
          if (chat.chat_id) ids.push(chat.chat_id);
        }
        pageToken = res?.data?.page_token ?? undefined;
      } while (pageToken);
    } catch (err) {
      console.error(`[${channelName}] 获取会话列表失败:`, err);
    }
    return ids;
  }

  /** 启动补漏：拉取停机期间的未处理消息 */
  async function catchUpMissedMessages(chatIds?: string[]): Promise<number> {
    if (!dedup || !messageHandler) return 0;
    const lastTime = dedup.getLastProcessedTime();
    if (!lastTime) return 0;

    const targetChats = chatIds?.length ? chatIds : await discoverChatIds();
    if (!targetChats.length) return 0;
    console.error(`[${channelName}] 开始补漏: ${targetChats.length} 个会话, 从 ${lastTime} 开始`);

    let caught = 0;
    for (const chatId of targetChats) {
      try {
        const res = await client.im.message.list({
          params: {
            container_id_type: 'chat',
            container_id: chatId,
            start_time: lastTime,
            page_size: 50,
            sort_type: 'ByCreateTimeAsc' as any,
          },
        });
        const items = res?.data?.items ?? [];
        for (const msg of items) {
          const msgId = msg.message_id;
          if (!msgId || dedup.isProcessed(msgId)) continue;
          if (msg.sender?.sender_type === 'app') continue;

          const senderId = msg.sender?.id;
          const contentRaw = msg.body?.content;
          if (!contentRaw) continue;

          let text = '';
          if (msg.msg_type === 'text') {
            const parsed = parseJsonContent(contentRaw);
            text = parsed && typeof parsed.text === 'string' ? parsed.text.trim() : '';
          } else if (msg.msg_type === 'post') {
            const parsed = parseJsonContent(contentRaw);
            text = parsed ? postToPlainText(parsed) : '';
          }
          if (!text || text.startsWith('/')) continue;

          console.error(`[${channelName}] 补漏消息: ${msgId} (${text.slice(0, 30)}...)`);
          enqueueMessage(chatId, msgId, senderId, text, msg.create_time);
          caught++;
        }
      } catch (err) {
        console.error(`[${channelName}] 补漏拉取失败 (chat=${chatId}):`, err);
      }
    }
    return caught;
  }

  /** 注册飞书事件 */
  dispatcher.register({
    'im.message.receive_v1': async (data: unknown) => {
      if (!isRecord(data)) return;
      const sender = data.sender;
      const message = data.message;
      if (!isRecord(sender) || !isRecord(message)) return;

      if (str(sender.sender_type) === 'app') return;

      const senderId = isRecord(sender.sender_id) ? sender.sender_id : {};
      const openId = str(senderId.open_id);

      if (config.allowFrom.size > 0 && openId && !config.allowFrom.has(openId)) return;

      const messageId = str(message.message_id);
      const chatId = str(message.chat_id);
      const messageType = str(message.message_type);
      const contentRaw = str(message.content);
      if (!messageId || !chatId || !messageType) return;

      const createTime = str(message.create_time);

      if (messageType === 'text') {
        if (!contentRaw) return;
        const parsed = parseJsonContent(contentRaw);
        const text = parsed && typeof parsed.text === 'string' ? parsed.text.trim() : '';
        if (text && !text.startsWith('/')) {
          enqueueMessage(chatId, messageId, openId, text, createTime);
        }
        return;
      }

      if (messageType === 'post') {
        if (!contentRaw) return;
        const parsed = parseJsonContent(contentRaw);
        const plain = parsed ? postToPlainText(parsed) : '';
        if (plain) {
          enqueueMessage(chatId, messageId, openId, plain, createTime);
        }
        return;
      }

      if (messageType === 'file') {
        if (!contentRaw) return;
        const parsed = parseJsonContent(contentRaw);
        const fileKey = parsed && typeof parsed.file_key === 'string' ? parsed.file_key : '';
        const fileName = parsed && typeof parsed.file_name === 'string' ? parsed.file_name : undefined;
        if (!fileKey) return;

        const attachment = await downloadFeishuFile(messageId, fileKey, fileName, 'file', openId);
        const label = fileName ? `[文件] ${fileName}` : '[文件]';
        enqueueMessage(chatId, messageId, openId, label, createTime,
          attachment ? [attachment] : undefined);
        return;
      }

      if (messageType === 'image') {
        if (!contentRaw) return;
        const parsed = parseJsonContent(contentRaw);
        const imageKey = parsed && typeof parsed.image_key === 'string' ? parsed.image_key : '';
        if (!imageKey) return;

        const attachment = await downloadFeishuFile(messageId, imageKey, `${imageKey}.png`, 'image', openId);
        enqueueMessage(chatId, messageId, openId, '[图片]', createTime,
          attachment ? [attachment] : undefined);
        return;
      }

      if (messageType === 'interactive') {
        if (!contentRaw) return;
        let summary = '[interactive card]';
        const parsed = parseJsonContent(contentRaw);
        if (parsed && isRecord(parsed.header)) {
          const title = parsed.header as Record<string, unknown>;
          if (isRecord(title.title) && typeof (title.title as Record<string, unknown>).content === 'string') {
            summary = `[card] ${(title.title as Record<string, unknown>).content}`;
          }
        }
        enqueueMessage(chatId, messageId, openId, summary, createTime);
      }
    },
  });

  /** Webhook HTTP 服务器 */
  async function startWebhook(): Promise<void> {
    const server = http.createServer((req, res) => {
      if (req.method !== 'POST' || req.url !== config.webhookPath) {
        res.statusCode = 404;
        res.end();
        return;
      }

      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        void (async () => {
          try {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            if (!verifySignature(req.headers, rawBody, config.encryptKey)) {
              res.statusCode = 401;
              res.end('Invalid signature');
              return;
            }

            let payload: unknown;
            try {
              payload = JSON.parse(rawBody);
            } catch {
              res.statusCode = 400;
              res.end('Invalid JSON');
              return;
            }
            if (!isRecord(payload)) {
              res.statusCode = 400;
              res.end('Invalid payload');
              return;
            }

            const { isChallenge, challenge } = Lark.generateChallenge(payload, {
              encryptKey: config.encryptKey || '',
            });
            if (isChallenge) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(challenge));
              return;
            }

            const envelope = Object.assign(Object.create({ headers: req.headers }), payload);
            const value = await dispatcher.invoke(envelope, { needCheck: false });
            if (!res.headersSent) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(value ?? {}));
            }
          } catch (err) {
            console.error(`[${channelName}] webhook error:`, err);
            if (!res.headersSent) {
              res.statusCode = 500;
              res.end('Internal Server Error');
            }
          }
        })();
      });
    });

    httpServer = server;
    const { createRequire } = await import('node:module');
    const { resolve: resolvePath, dirname } = await import('node:path');
    const _req = createRequire(import.meta.url);
    const sdkPath = resolvePath(dirname(new URL(import.meta.url).pathname), '..', '..', '..', '..', 'PolarPort', 'dist', 'sdk', 'index.js');
    const { claimPort } = _req(sdkPath);
    const port = await claimPort({ service: `polarclaw-feishu-${channelName}`, project: 'PolarClaw', preferred: config.webhookPort });

    await new Promise<void>((resolve, reject) => {
      server.listen(port, config.webhookHost, () => resolve());
      server.once('error', reject);
    });
    alive = true;
    lastError = null;
    console.error(`[${channelName}] webhook server listening on ${config.webhookHost}:${port}${config.webhookPath}`);
  }

  /** WebSocket 长连接 */
  async function startWs(): Promise<void> {
    wsClient = new Lark.WSClient({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: resolveSdkDomain(config),
      loggerLevel: Lark.LoggerLevel.info,
    });
    await wsClient.start({ eventDispatcher: dispatcher });
    alive = true;
    lastError = null;
    console.error(`[${channelName}] WebSocket connected`);
  }

  return {
    name: channelName,

    async start() {
      if (transport === 'webhook') {
        await startWebhook();
      } else {
        await startWs();
      }
    },

    async catchUp(chatIds?: string[]) {
      const caught = await catchUpMissedMessages(chatIds);
      if (caught > 0) {
        console.error(`[${channelName}] 启动补漏完成: 处理了 ${caught} 条遗漏消息`);
      }
      dedup?.flush();
    },

    async stop() {
      alive = false;
      for (const [key, batch] of pendingBatches) {
        clearTimeout(batch.timer);
        await flushBatch(key);
      }
      dedup?.flush();
      if (wsClient) {
        try { wsClient.close(); } catch { /* ignore */ }
        wsClient = null;
      }
      if (httpServer) {
        await new Promise<void>(resolve => {
          httpServer!.close(() => resolve());
        });
        httpServer = null;
      }
    },

    async send(message: IOutboundMessage) {
      const res = await client.im.message.create({
        params: { receive_id_type: 'open_id' },
        data: {
          receive_id: message.userId,
          msg_type: message.card ? 'interactive' : 'text',
          content: message.card
            ? JSON.stringify(message.card)
            : JSON.stringify({ text: message.text }),
        },
      });
      if (isRecord(res) && res.code !== undefined && res.code !== 0) {
        throw new Error(`Feishu send failed: ${res.msg} (code ${res.code})`);
      }
    },

    onMessage(handler) {
      messageHandler = handler;
    },

    isAlive(): boolean {
      return alive;
    },

    getLastEventTime(): string | null {
      return lastEventAt !== null ? new Date(lastEventAt).toISOString() : null;
    },

    getLastError(): { code: string; message: string } | null {
      return lastError;
    },
  };
}
