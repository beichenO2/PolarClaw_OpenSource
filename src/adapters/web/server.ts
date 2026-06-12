/**
 * PolarClaw Web Server — serves the Web SPA and provides REST APIs
 * for review items (PDF annotations, PPT diffs) and agent status.
 */

import express from 'express';
import multer from 'multer';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, renameSync, copyFileSync } from 'node:fs';
import { join, extname, basename } from 'node:path';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fetchEcosystemHealth } from '../../sdk/ecosystem-health.js';
import {
  isLocked,
  getLockInfo,
  getLockAgeMs,
  acquireLock,
  releaseLock,
  type LockInfo,
} from '../../sdk/project-lock.js';

import type { AgentProgressEvent, IAgentRuntimeOptions } from '../../core/agent.js';

export interface WebServerConfig {
  port: number;
  dataDir: string;
  webDistDir?: string;
  getStatus?: () => AgentStatusData;
  llm?: import('../../ports/llm.js').ILLMRouter;
  memoryStore?: import('../../ports/memory.js').IMemoryStore;
  conversations?: import('../../ports/memory.js').IConversationHistory;
  /** SessionMemoryManager — working/episodic/coreFacts/longTermBlocks（对外暴露 /api/session-memory/*） */
  sessionMemory?: import('../../memory/SessionMemory.js').SessionMemoryManager;
  /** Full agent handler (ReAct loop + tools + memory + privacy) */
  agentHandler?: (msg: { channel: string; userId: string; text: string }) => Promise<string>;
  /** Streaming agent handler — returns final text, pushes progress via callback */
  agentHandlerStream?: (
    msg: { channel: string; userId: string; text: string },
    onProgress: (event: AgentProgressEvent) => void,
    runtime?: IAgentRuntimeOptions,
  ) => Promise<string>;
  yoloEngine?: {
    run(config: { projectId: string; sessionId?: string; goal: string; maxSteps: number; maxTotalTokens: number; maxWallTimeMs: number; maxRetries: number },
        context: { channel: string; userId: string; projectId: string }): Promise<YoloSessionData>;
    cancel(sessionId: string): void;
    getSession(sessionId: string): YoloSessionData | null;
  };
  /** PolarClaw SDK instance (provides /api/sdk/* routes) */
  sdk?: import('../../sdk/index.js').PolarClawSDK;
}

export interface AgentStatusData {
  name: string;
  version: string;
  channels: { name: string; connected: boolean; lastEventTime?: string | null; lastError?: { code: string; message: string } | null }[];
  uptime: number;
  memory: { totalEntries: number; dbSizeBytes: number };
  skills: { count: number; names: string[] };
  yolo: { activeSessions: number };
  hubWeb?: {
    agentId: string | null;
    sseConnected: boolean;
    lastHeartbeatAt: string | null;
    lastPromptAt: string | null;
    lastError: string | null;
  };
}

export interface YoloSessionData {
  sessionId: string;
  status: string;
  stepsCompleted: number;
  totalTokensUsed: number;
  elapsedMs: number;
  steps: { step: number; text: string; tokensUsed: number; goalReached: boolean; error?: string; durationMs: number }[];
  stopReason?: string;
}

interface ReviewRecord {
  id: string;
  type: 'pdf' | 'ppt';
  filename: string;
  status: 'pending' | 'reviewed' | 'approved';
  agent_id: string;
  annotations: AnnotationRecord[];
  slides?: { index: number; image_url: string }[];
  agent_diffs?: PptDiffRecord[];
  user_diffs?: PptDiffRecord[];
  created_at: string;
  updated_at: string;
}

interface AnnotationRecord {
  id: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  comment: string;
  author: string;
  created_at: string;
}

interface PptDiffRecord {
  slide_index: number;
  change_type: 'add' | 'remove' | 'modify';
  target: string;
  before: string;
  after: string;
}

function findLibreOffice(): string | null {
  const candidates = [
    '/usr/bin/libreoffice',
    '/usr/bin/soffice',
    '/Applications/LibreOffice.app/Contents/MacOS/soffice',
    '/opt/homebrew/bin/soffice',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  try {
    const which = execSync('which soffice 2>/dev/null || which libreoffice 2>/dev/null', { encoding: 'utf8' }).trim();
    if (which) return which;
  } catch { /* not found */ }
  return null;
}

function convertPptxToImages(pptxPath: string, outDir: string): string[] {
  const soffice = findLibreOffice();
  if (!soffice) {
    console.error('[WebServer] LibreOffice not found — PPT slide rendering unavailable');
    return [];
  }

  mkdirSync(outDir, { recursive: true });
  try {
    execSync(`"${soffice}" --headless --convert-to png --outdir "${outDir}" "${pptxPath}"`, {
      timeout: 60000,
      encoding: 'utf8',
    });
  } catch (err) {
    console.error('[WebServer] LibreOffice conversion failed:', err);
    return [];
  }

  return readdirSync(outDir)
    .filter((f) => f.endsWith('.png'))
    .sort()
    .map((f) => join(outDir, f));
}

export function createWebServer(config: WebServerConfig) {
  const app = express();
  app.use((_req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');
    if (_req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });
  app.use(express.json({ limit: '50mb' }));

  const reviewDir = join(config.dataDir, 'reviews');
  const uploadsDir = join(config.dataDir, 'uploads');
  const slidesDir = join(config.dataDir, 'slides');
  mkdirSync(reviewDir, { recursive: true });
  mkdirSync(uploadsDir, { recursive: true });
  mkdirSync(slidesDir, { recursive: true });

  const upload = multer({ dest: uploadsDir });

  function loadReviews(): ReviewRecord[] {
    const indexPath = join(reviewDir, 'index.json');
    if (!existsSync(indexPath)) return [];
    try {
      return JSON.parse(readFileSync(indexPath, 'utf8'));
    } catch { return []; }
  }

  function saveReviews(records: ReviewRecord[]) {
    writeFileSync(join(reviewDir, 'index.json'), JSON.stringify(records, null, 2));
  }

  // ── Chat deployments（统一 Chat 壳 workflow 注册表） ──
  const deploymentsPath = join(config.dataDir, 'chat-deployments.json');
  interface ChatDeployment {
    id: string;
    workflow_id: string;
    library: 'WF' | 'LG';
    display_name: string;
    deployed_at: string;
    memory?: string;
  }
  function loadDeployments(): ChatDeployment[] {
    if (!existsSync(deploymentsPath)) return [];
    try {
      return JSON.parse(readFileSync(deploymentsPath, 'utf8')) as ChatDeployment[];
    } catch { return []; }
  }
  function saveDeployments(list: ChatDeployment[]) {
    writeFileSync(deploymentsPath, JSON.stringify(list, null, 2));
  }

  const distDir = config.webDistDir ?? '';

  app.get('/api/deployments', (_req, res) => {
    res.json(loadDeployments());
  });

  app.get('/api/deployments/:id/manifest', (req, res) => {
    const item = loadDeployments().find(d => d.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'not found' });
    res.json(item);
  });

  app.put('/api/deployments', (req, res) => {
    const body = req.body as Partial<ChatDeployment>;
    if (!body.workflow_id || !body.display_name) {
      return res.status(400).json({ error: 'workflow_id and display_name required' });
    }
    const list = loadDeployments();
    const id = body.id ?? body.workflow_id;
    const entry: ChatDeployment = {
      id,
      workflow_id: body.workflow_id,
      library: (body.library === 'LG' ? 'LG' : 'WF'),
      display_name: body.display_name,
      deployed_at: new Date().toISOString(),
      memory: body.memory ?? 'WorkingMemory',
    };
    const idx = list.findIndex(d => d.id === id);
    if (idx >= 0) list[idx] = entry;
    else list.push(entry);
    saveDeployments(list);
    res.json({ ok: true, deployment: entry, chat_url: `/chat?workflow=${encodeURIComponent(id)}` });
  });

  app.delete('/api/deployments/:id', (req, res) => {
    const list = loadDeployments().filter(d => d.id !== req.params.id);
    saveDeployments(list);
    res.json({ ok: true });
  });

  // ── Chat shell 占位（Phase 4 React SPA 在 /mc/chat；此处重定向） ──
  app.get('/chat', (req, res) => {
    const q = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
    if (existsSync(join(distDir, 'index.html'))) {
      return res.redirect(`/mc/chat${q}`);
    }
    const deployments = loadDeployments();
    const options = deployments.map(d =>
      `<option value="${d.id}">${d.display_name} (${d.workflow_id})</option>`,
    ).join('');
    res.type('html').send(`<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"/><title>PolarUI Chat</title>
<style>
body{font-family:system-ui;background:#212121;color:#ececec;margin:0;min-height:100vh;display:flex;flex-direction:column}
header{padding:12px 16px;border-bottom:1px solid #444;display:flex;gap:12px;align-items:center}
select,button{background:#2f2f2f;color:#ececec;border:1px solid #555;border-radius:8px;padding:8px 12px}
main{flex:1;display:flex;flex-direction:column;max-width:768px;margin:0 auto;width:100%;padding:16px;box-sizing:border-box}
#log{flex:1;overflow:auto;margin-bottom:12px}
.msg{padding:12px;margin:8px 0;border-radius:12px;max-width:85%}
.msg.user{background:#2f2f2f;margin-left:auto}
.msg.assistant{background:#343541}
footer{display:flex;gap:8px}
textarea{flex:1;background:#2f2f2f;color:#ececec;border:1px solid #555;border-radius:12px;padding:12px;resize:none;min-height:52px}
.note{font-size:12px;color:#888;margin-top:8px}
</style></head><body>
<header><strong>PolarUI Chat</strong>
<select id="wf"><option value="">— 选择 workflow —</option>${options}</select>
<button id="newChat">新对话</button></header>
<main><div id="log"></div>
<footer><textarea id="input" placeholder="输入消息…" rows="2"></textarea><button id="send">发送</button></footer>
<p class="note">Phase 3 占位 UI · Phase 4 由 PolarDesign 复刻 ChatGPT 完整界面</p></main>
<script>
const wf=document.getElementById('wf'), log=document.getElementById('log'), input=document.getElementById('input');
let convId=localStorage.getItem('polarui_chat_conv')||('chat_'+Date.now());
localStorage.setItem('polarui_chat_conv', convId);
const q=new URLSearchParams(location.search); if(q.get('workflow')) wf.value=q.get('workflow');
document.getElementById('newChat').onclick=()=>{convId='chat_'+Date.now();localStorage.setItem('polarui_chat_conv',convId);log.innerHTML='';};
function add(role,text){const d=document.createElement('div');d.className='msg '+role;d.textContent=text;log.appendChild(d);log.scrollTop=log.scrollHeight;}
document.getElementById('send').onclick=async()=>{
  const w=wf.value, t=input.value.trim(); if(!w||!t) return;
  add('user',t); input.value='';
  const r=await fetch('/api/workflow/chat',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({workflow_id:w,conversation_id:convId,message:t})});
  const j=await r.json(); add('assistant', j.content||j.error||'（无回复）');
};
</script></body></html>`);
  });

  // ── Static: serve Web SPA ──────────────────────────────
  if (existsSync(distDir)) {
    app.use('/mc', express.static(distDir));
    app.get(/^\/mc\/.*/, (_req, res) => {
      res.sendFile(join(distDir, 'index.html'));
    });
  }

  // ── Static: serve uploaded files and slide images ──────
  app.use('/files', express.static(uploadsDir));
  app.use('/slides', express.static(slidesDir));

  // ── API: status ────────────────────────────────────────
  app.get('/api/status', (_req, res) => {
    if (config.getStatus) {
      res.json(config.getStatus());
    } else {
      res.json({
        name: 'PolarClaw',
        version: '0.1.0',
        channels: [],
        uptime: process.uptime(),
        memory: { totalEntries: 0, dbSizeBytes: 0 },
        skills: { count: 0, names: [] },
        yolo: { activeSessions: 0 },
      });
    }
  });

  // ── API: ecosystem status ───────────────────────────────
  app.get('/api/ecosystem/status', async (_req, res) => {
    try {
      const polarclawStatus = config.getStatus ? config.getStatus() : undefined;
      const hubWebStatus = (globalThis as Record<string, unknown>).__polarClawHubWebStatus;
      const hubAgentId = hubWebStatus && typeof hubWebStatus === 'object'
        ? (hubWebStatus as { agentId?: string | null }).agentId ?? null
        : null;
      const result = await fetchEcosystemHealth({
        polarclawStatus,
        hubAgentId,
      });
      res.json(result);
    } catch (err) {
      console.error('[PolarClaw] /api/ecosystem/status error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ── API: models (list configured models) ────────────
  app.get('/api/models', (_req, res) => {
    if (!config.llm) return res.json({ models: [] });
    const { model: _unused, intent: _i, ...resolveInfo } = config.llm.resolveModel([{ role: 'user', content: 'test' }]);
    const modelSet = new Set<string>();
    const intentModels: Record<string, string> = {};
    for (const intent of ['general', 'coding', 'research', 'vision'] as const) {
      const { model: m } = config.llm.resolveModel([{ role: 'user', content:
        intent === 'coding' ? '写代码' : intent === 'research' ? '研究论文' : intent === 'vision' ? '看图片' : '你好'
      }]);
      modelSet.add(m);
      intentModels[intent] = m;
    }
    res.json({ models: [...modelSet], intent_models: intentModels });
  });

  // ── API: agent chat (full ReAct loop with tools) ────────
  app.post('/api/agent/chat', async (req, res) => {
    console.error(`[WebServer] /api/agent/chat received, hasHandler=${!!config.agentHandler}`);
    if (!config.agentHandler) return res.status(503).json({ error: 'agent not available' });
    try {
      const { message, conversation_id } = req.body as {
        message?: string;
        conversation_id?: string;
      };
      if (!message || typeof message !== 'string') {
        return res.status(400).json({ error: 'message (string) required' });
      }
      const channel = conversation_id ? `hub:${conversation_id}` : 'hub:anonymous';
      console.error(`[WebServer] calling agentHandler (channel=${channel})`);
      const reply = await config.agentHandler({
        channel,
        userId: 'hub-user',
        text: message,
      });
      console.error(`[WebServer] agentHandler returned, replyLen=${reply?.length ?? 'null'}`);
      res.json({ content: reply, conversation_id: channel });
      console.error(`[WebServer] response sent`);
    } catch (err) {
      console.error('[PolarClaw] /api/agent/chat error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ── API: agent chat SSE (streaming progress) ──────────
  app.post('/api/agent/chat/stream', async (req, res) => {
    const handler = config.agentHandlerStream ?? config.agentHandler;
    if (!handler) return res.status(503).json({ error: 'agent not available' });

    const { message, conversation_id, settings } = req.body as {
      message?: string;
      conversation_id?: string;
      settings?: {
        thinkingCapability?: string;
        toolCapability?: string;
        maxRounds?: number;
        retryLoop?: boolean;
      };
    };
    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'message (string) required' });
    }

    // Sanitize panel settings → runtime options (only forward well-formed values).
    const capRe = /^V?[01]{4}$|^L[01]{4}$/i;
    const runtime: IAgentRuntimeOptions = {};
    if (settings?.thinkingCapability && capRe.test(settings.thinkingCapability)) {
      runtime.thinkingCapability = settings.thinkingCapability.toUpperCase().startsWith('V')
        ? settings.thinkingCapability.toUpperCase() : settings.thinkingCapability;
    }
    if (settings?.toolCapability && capRe.test(settings.toolCapability)) {
      runtime.toolCapability = settings.toolCapability.toUpperCase().startsWith('V')
        ? settings.toolCapability.toUpperCase() : settings.toolCapability;
    }
    if (typeof settings?.maxRounds === 'number' && Number.isFinite(settings.maxRounds)) {
      runtime.maxRounds = Math.max(0, Math.min(50, Math.floor(settings.maxRounds)));
    }
    if (typeof settings?.retryLoop === 'boolean') {
      runtime.retryLoop = settings.retryLoop;
    }

    req.socket?.setNoDelay(true);
    req.socket?.setTimeout(0);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(':ok\n\n');

    const channel = conversation_id ? `hub:${conversation_id}` : 'hub:anonymous';
    let closed = false;
    res.on('close', () => { closed = true; });

    const sendEvent = (event: string, data: unknown) => {
      if (closed) return;
      const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      res.write(payload);
    };

    try {
      if (config.agentHandlerStream) {
        let lastDoneEvt: AgentProgressEvent | null = null;
        const reply = await config.agentHandlerStream(
          { channel, userId: 'hub-user', text: message },
          (evt) => {
            if (evt.type === 'done') {
              lastDoneEvt = evt;
            } else {
              sendEvent(evt.type, evt);
            }
          },
          runtime,
        );
        sendEvent('done', lastDoneEvt ?? { type: 'done', content: reply });
      } else {
        sendEvent('thinking', { type: 'thinking', round: 0 });
        const reply = await config.agentHandler!({ channel, userId: 'hub-user', text: message });
        sendEvent('done', { type: 'done', content: reply });
      }
    } catch (err) {
      sendEvent('error', { type: 'error', message: String(err) });
    } finally {
      if (!closed) res.end();
    }
  });

  // ── API: conversations (list + history for IDE plugin) ──
  app.get('/api/conversations', (_req, res) => {
    if (!config.conversations?.listConversations) {
      return res.json([]);
    }
    const limit = parseInt(String(_req.query.limit)) || 50;
    const list = config.conversations.listConversations(limit);
    res.json(list);
  });

  app.get('/api/conversations/:id', (req, res) => {
    if (!config.conversations) {
      return res.json({ messages: [] });
    }
    const limit = parseInt(String(req.query.limit)) || 200;
    const messages = config.conversations.getHistory(req.params.id, { limit, fromLatest: true });
    res.json({
      conversationId: req.params.id,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        timestamp: m.timestamp?.toISOString?.() ?? null,
      })),
    });
  });

  // ── API: chat (LLM proxy for external callers) ────────
  app.post('/api/chat', async (req, res) => {
    if (!config.llm) return res.status(503).json({ error: 'llm not configured' });
    try {
      const { messages, system, context_query, max_tokens, model: requestedModel, memory_user_id } = req.body as {
        messages?: Array<{ role: string; content: string }>;
        system?: string;
        context_query?: string;
        max_tokens?: number;
        model?: string;
        /** When set, scopes FTS memory recall to this user (defaults to admin). */
        memory_user_id?: string;
      };
      if (!messages || !Array.isArray(messages)) {
        return res.status(400).json({ error: 'messages[] required' });
      }

      const chatMessages: Array<{ role: 'system' | 'user' | 'assistant' | 'tool'; content: string }> = [];

      if (system) {
        chatMessages.push({ role: 'system', content: system });
      }

      if (context_query && config.memoryStore) {
        const memUser =
          typeof memory_user_id === 'string' && memory_user_id.trim() !== '' ? memory_user_id.trim() : 'admin';
        const memResults = config.memoryStore.search(context_query, { limit: 5, userId: memUser });
        if (memResults.entries.length > 0) {
          const memContext = memResults.entries.map(e => e.content).join('\n---\n');
          chatMessages.push({ role: 'system', content: `## 长期记忆上下文\n${memContext}` });
        }
      }

      for (const m of messages) {
        chatMessages.push({ role: m.role as 'user' | 'assistant', content: m.content });
      }

      const resolvedModel = requestedModel || config.llm.resolveModel(chatMessages).model;
      const result = await config.llm.chat(chatMessages, {
        model: requestedModel || undefined,
        temperature: 0.3,
        maxTokens: max_tokens ?? 4096,
      });
      res.json({
        content: result.content ?? '',
        usage: result.usage,
        model: resolvedModel,
      });
    } catch (err) {
      console.error('[PolarClaw] /api/chat error:', err);
      res.status(500).json({ error: String(err) });
    }
  });

  // ── API: YOLO sessions ─────────────────────────────────
  const knownSessionIds: string[] = [];

  app.get('/api/yolo/sessions', (_req, res) => {
    if (!config.yoloEngine) return res.json([]);
    const sessions = knownSessionIds
      .map(id => config.yoloEngine!.getSession(id))
      .filter((s): s is YoloSessionData => s !== null);
    res.json(sessions);
  });

  app.get('/api/yolo/sessions/:id', (req, res) => {
    if (!config.yoloEngine) return res.status(404).json({ error: 'yolo engine not available' });
    const session = config.yoloEngine.getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'session not found' });
    res.json(session);
  });

  app.post('/api/yolo/start', (req, res) => {
    if (!config.yoloEngine) return res.status(503).json({ error: 'yolo engine not available' });
    const { project_id, goal, max_steps } = req.body as { project_id?: string; goal?: string; max_steps?: number };
    if (!project_id?.trim()) return res.status(400).json({ error: 'project_id is required' });
    if (!goal?.trim()) return res.status(400).json({ error: 'goal is required' });

    const sessionId = `yolo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    knownSessionIds.push(sessionId);

    config.yoloEngine.run(
      { projectId: project_id.trim(), sessionId, goal: goal.trim(), maxSteps: max_steps ?? 10, maxTotalTokens: 200000, maxWallTimeMs: 600000, maxRetries: 2 },
      { channel: 'web', userId: 'admin', projectId: project_id.trim() },
    ).catch(err => console.error('[WebServer] YOLO run error:', err));

    res.json({ ok: true, sessionId });
  });

  app.post('/api/yolo/cancel/:id', (req, res) => {
    if (!config.yoloEngine) return res.status(503).json({ error: 'yolo engine not available' });
    config.yoloEngine.cancel(req.params.id);
    res.json({ ok: true });
  });

  // ── API: review list ───────────────────────────────────
  app.get('/api/review', (_req, res) => {
    res.json(loadReviews());
  });

  // ── API: review get ────────────────────────────────────
  app.get('/api/review/:id', (req, res) => {
    const records = loadReviews();
    const record = records.find((r) => r.id === req.params.id);
    if (!record) return res.status(404).json({ error: 'not found' });
    res.json(record);
  });

  // ── API: review file download ──────────────────────────
  app.get('/api/review/:id/file', (req, res) => {
    const records = loadReviews();
    const record = records.find((r) => r.id === req.params.id);
    if (!record) return res.status(404).json({ error: 'not found' });
    const filePath = join(uploadsDir, record.id + extname(record.filename));
    if (!existsSync(filePath)) return res.status(404).json({ error: 'file not found' });
    res.sendFile(filePath);
  });

  // ── API: upload review file ────────────────────────────
  app.post('/api/review/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'no file' });

    const ext = extname(req.file.originalname).toLowerCase();
    const type = ext === '.pdf' ? 'pdf' : 'ppt';
    const id = randomUUID();
    const agentId = (req.body as { agent_id?: string })?.agent_id ?? 'local';

    const destPath = join(uploadsDir, id + ext);
    try { renameSync(req.file.path, destPath); } catch { copyFileSync(req.file.path, destPath); unlinkSync(req.file.path); }

    let slides: ReviewRecord['slides'] = [];
    if (type === 'ppt') {
      const slideOutDir = join(slidesDir, id);
      const imagePaths = convertPptxToImages(destPath, slideOutDir);
      slides = imagePaths.map((p, i) => ({
        index: i,
        image_url: `/slides/${id}/${basename(p)}`,
      }));
    }

    const record: ReviewRecord = {
      id,
      type,
      filename: req.file.originalname,
      status: 'pending',
      agent_id: agentId,
      annotations: [],
      slides,
      agent_diffs: [],
      user_diffs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const records = loadReviews();
    records.push(record);
    saveReviews(records);

    res.json({ ok: true, id, slides: slides?.length ?? 0 });
  });

  // ── API: add annotation ────────────────────────────────
  app.post('/api/review/:id/annotate', (req, res) => {
    const records = loadReviews();
    const idx = records.findIndex((r) => r.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'not found' });

    const body = req.body as Partial<AnnotationRecord>;
    const ann: AnnotationRecord = {
      id: `ann-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      page: body.page ?? 1,
      x: body.x ?? 0,
      y: body.y ?? 0,
      width: body.width ?? 0,
      height: body.height ?? 0,
      comment: body.comment ?? '',
      author: body.author ?? 'user',
      created_at: new Date().toISOString(),
    };

    const rec = records[idx]!;
    rec.annotations.push(ann);
    rec.status = 'reviewed';
    rec.updated_at = new Date().toISOString();
    saveReviews(records);

    res.json({ ok: true, annotation: ann });
  });

  // ── API: submit PPT diffs ──────────────────────────────
  app.post('/api/review/:id/diff', (req, res) => {
    const records = loadReviews();
    const idx = records.findIndex((r) => r.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'not found' });

    const { diffs } = req.body as { diffs: PptDiffRecord[] };
    const rec = records[idx]!;
    rec.user_diffs = diffs;
    rec.status = 'reviewed';
    rec.updated_at = new Date().toISOString();
    saveReviews(records);

    res.json({ ok: true });
  });

  // ── API: approve ───────────────────────────────────────
  app.post('/api/review/:id/approve', (req, res) => {
    const records = loadReviews();
    const idx = records.findIndex((r) => r.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'not found' });

    const rec = records[idx]!;
    rec.status = 'approved';
    rec.updated_at = new Date().toISOString();
    saveReviews(records);

    res.json({ ok: true });
  });

  // ── API: agent can push review items programmatically ──
  app.post('/api/review', (req, res) => {
    const body = req.body as Partial<ReviewRecord>;
    const record: ReviewRecord = {
      id: body.id ?? randomUUID(),
      type: body.type ?? 'pdf',
      filename: body.filename ?? 'unknown',
      status: 'pending',
      agent_id: body.agent_id ?? 'agent',
      annotations: [],
      slides: body.slides ?? [],
      agent_diffs: body.agent_diffs ?? [],
      user_diffs: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const records = loadReviews();
    records.push(record);
    saveReviews(records);

    res.json({ ok: true, id: record.id });
  });

  // ── API: delete review item ────────────────────────────
  app.delete('/api/review/:id', (req, res) => {
    const records = loadReviews();
    const idx = records.findIndex((r) => r.id === req.params.id);
    if (idx < 0) return res.status(404).json({ error: 'not found' });

    const removed = records.splice(idx, 1)[0]!;
    saveReviews(records);

    const filePath = join(uploadsDir, removed.id + extname(removed.filename));
    try { unlinkSync(filePath); } catch { /* ok */ }

    res.json({ ok: true });
  });

  // ── API: session-memory (PolarUI WorkingMemory 节点消费) ──
  if (config.sessionMemory) {
    const sm = config.sessionMemory;

    app.get('/api/session-memory/:convId', (req, res) => {
      const convId = req.params.convId;
      try {
        const session = sm.getOrCreateSession(convId);
        const context = sm.buildMemoryInjection(convId);
        res.json({
          conversation_id: convId,
          context,
          working_count: session.working.length,
          episodic_count: session.episodic.length,
          long_term_count: session.longTermBlocks.length,
          core_facts: session.coreFacts || '',
        });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    app.post('/api/session-memory/:convId/messages', (req, res) => {
      const convId = req.params.convId;
      const body = req.body as {
        messages?: Array<{ role: string; content: string }>;
        message?: string;
        role?: 'user' | 'assistant' | 'system' | 'tool';
        replace?: boolean;
      };
      try {
        const session = sm.getOrCreateSession(convId);
        const incoming = body.messages
          ? body.messages.map(m => ({
              role: m.role as 'system' | 'user' | 'assistant' | 'tool',
              content: String(m.content ?? ''),
            }))
          : body.message
          ? [{ role: (body.role ?? 'user') as 'system' | 'user' | 'assistant' | 'tool', content: String(body.message) }]
          : [];
        if (incoming.length === 0) {
          return res.status(400).json({ error: 'messages[] or message required' });
        }
        const next = body.replace ? incoming : [...session.working, ...incoming];
        sm.updateWorkingMemory(convId, next);
        res.json({ conversation_id: convId, working_count: next.length });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    app.post('/api/session-memory/:convId/compress', async (req, res) => {
      const convId = req.params.convId;
      try {
        const compressed = await sm.compressForNextTurn(convId);
        const session = sm.getOrCreateSession(convId);
        res.json({
          conversation_id: convId,
          compressed_chars: compressed.length,
          episodic_count: session.episodic.length,
          working_count: session.working.length,
        });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    app.post('/api/session-memory/:convId/fetch', async (req, res) => {
      const convId = req.params.convId;
      const { query, user_id } = req.body as { query?: string; user_id?: string };
      if (!query || !user_id) {
        return res.status(400).json({ error: 'query + user_id required' });
      }
      try {
        const blocks = await sm.fetchLongTermMemory(String(query), String(user_id));
        const session = sm.getOrCreateSession(convId);
        session.longTermBlocks = blocks;
        res.json({ conversation_id: convId, blocks_count: blocks.length });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    app.post('/api/session-memory/:convId/core-facts', (req, res) => {
      const convId = req.params.convId;
      const { facts } = req.body as { facts?: string };
      try {
        sm.updateCoreFacts(convId, String(facts ?? ''));
        res.json({ conversation_id: convId, ok: true });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    app.delete('/api/session-memory/:convId', (req, res) => {
      const convId = req.params.convId;
      try {
        sm.clearSession(convId);
        res.json({ conversation_id: convId, ok: true });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });
  }

  // ── API: workflow chat（PolarUI headless execute，供统一 Chat 壳） ──
  app.post('/api/workflow/chat', async (req, res) => {
    const body = req.body as {
      workflow_id?: string;
      conversation_id?: string;
      message?: string;
      user_id?: string;
    };
    const { workflow_id, conversation_id, message, user_id } = body;
    if (!workflow_id || !conversation_id || !message) {
      return res.status(400).json({ error: 'workflow_id, conversation_id, message required' });
    }
    const polarUiRoot = join(config.dataDir, '..', '..', 'PolarUI');
    const script = join(polarUiRoot, 'scripts', 'run-workflow-chat-once.mjs');
    if (!existsSync(script)) {
      return res.status(503).json({ error: `PolarUI chat script not found: ${script}` });
    }
    const npxBin = process.env.NPX ?? 'npx';
    const args = [
      'tsx', script,
      '--workflow', workflow_id,
      '--conversation-id', conversation_id,
      '--message', message,
    ];
    if (user_id) args.push('--user-id', user_id);
    const spawnEnv = {
      ...process.env,
      PATH: process.env.PATH ?? '~/.nvm/versions/node/v20.20.2/bin:/usr/bin:/bin',
      POLARCLAW_WEB_URL: `http://127.0.0.1:${config.port}`,
    };
    const r = await new Promise<{ status: number | null; stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(npxBin, args, {
        cwd: polarUiRoot,
        env: spawnEnv,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error('workflow chat timeout after 300s'));
      }, 300_000);
      child.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (status) => {
        clearTimeout(timer);
        resolve({ status: status ?? 1, stdout, stderr });
      });
    }).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      return { status: 1, stdout: '', stderr: msg };
    });
    const stdout = r.stdout.trim();
    const stderr = r.stderr.trim();
    if (!stdout) {
      return res.status(500).json({ error: stderr || 'workflow chat produced no output' });
    }
    try {
      const parsed = JSON.parse(stdout.split('\n').filter(Boolean).pop() ?? stdout) as Record<string, unknown>;
      if (r.status !== 0 && !parsed.content) {
        return res.status(500).json({ ...parsed, stderr: stderr.slice(-500) });
      }
      res.json(parsed);
    } catch {
      res.status(500).json({ error: 'invalid workflow chat JSON', stdout: stdout.slice(-800), stderr: stderr.slice(-400) });
    }
  });

  // ── SDK API routes (/api/sdk/*) ──────────────────────────
  if (config.sdk) {
    const sdk = config.sdk;

    app.get('/api/sdk/version', (_req, res) => {
      res.json({ version: sdk.version });
    });

    // Users
    app.get('/api/sdk/users/:id', (req, res) => {
      try {
        const result = sdk.users.resolve(req.params.id);
        res.json(result);
      } catch (err: any) {
        res.status(err.code === 'user_not_found' ? 404 : 400).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.get('/api/sdk/users', (_req, res) => {
      res.json({
        humans: sdk.users.listHumans(),
        projects: sdk.users.listProjects(),
      });
    });

    // Events
    app.post('/api/sdk/events', async (req, res) => {
      try {
        const result = await sdk.events.emit(req.body);
        res.status(result.accepted ? 201 : 200).json(result);
      } catch (err: any) {
        const status = err.code === 'invalid_event' || err.code === 'validation_error' ? 400 : 502;
        res.status(status).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.get('/api/sdk/events', async (req, res) => {
      try {
        const project = req.query.project as string | undefined;
        const since = req.query.since as string | undefined;
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
        res.json(await sdk.events.query({ project, since, limit }));
      } catch (err: any) {
        res.status(502).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    // Targets
    app.get('/api/sdk/targets/:projectId', async (req, res) => {
      try {
        res.json(await sdk.targets.list(req.params.projectId));
      } catch (err: any) {
        res.status(502).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.get('/api/sdk/targets/:projectId/:targetId', async (req, res) => {
      try {
        res.json(await sdk.targets.get(req.params.projectId, req.params.targetId));
      } catch (err: any) {
        const status = err.code === 'target_not_found' || err.status === 404 ? 404 : 502;
        res.status(status).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.post('/api/sdk/targets/:projectId', async (req, res) => {
      try {
        const target = await sdk.targets.create(req.params.projectId, req.body);
        res.status(201).json(target);
      } catch (err: any) {
        const status = err.code === 'project_not_found' || err.status === 404 ? 404 : 502;
        res.status(status).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.put('/api/sdk/targets/:projectId/:targetId', async (req, res) => {
      try {
        const target = await sdk.targets.update(req.params.projectId, req.params.targetId, req.body);
        res.json(target);
      } catch (err: any) {
        const status = err.code === 'target_not_found' || err.status === 404 ? 404 : 502;
        res.status(status).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.post('/api/sdk/targets/:projectId/:targetId/arrow', async (req, res) => {
      try {
        const target = await sdk.targets.appendArrowLog(req.params.projectId, req.params.targetId, req.body);
        res.json(target);
      } catch (err: any) {
        const status = err.code === 'target_not_found' || err.status === 404 ? 404 : 502;
        res.status(status).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.post('/api/sdk/targets/:projectId/:targetId/test', async (req, res) => {
      try {
        const result = await sdk.targets.runTest(req.params.projectId, req.params.targetId);
        res.json(result);
      } catch (err: any) {
        res.status(err.code === 'target_not_found' ? 404 : 400).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    // ── ComputerUse (sandbox-external browser automation) ──
    // Other Polarisor projects route their browser automation here so
    // Chromium only ever runs inside PolarClaw's sandbox. The X-PolarClaw-Project
    // header (set by polarclaw-project-sdk) is the calling project ID.

    app.post('/api/sdk/computer-use/browse', async (req, res) => {
      try {
        const result = await sdk.computerUse.browse(req.body ?? {});
        res.status(result.ok ? 200 : 502).json(result);
      } catch (err: any) {
        res.status(500).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.post('/api/sdk/computer-use/screenshot', async (req, res) => {
      try {
        const result = await sdk.computerUse.screenshot(req.body ?? {});
        res.status(result.ok ? 200 : 502).json(result);
      } catch (err: any) {
        res.status(500).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    app.post('/api/sdk/computer-use/fill-form', async (req, res) => {
      try {
        const result = await sdk.computerUse.fillForm(req.body ?? {});
        res.status(result.ok ? 200 : 502).json(result);
      } catch (err: any) {
        res.status(500).json(err.toJSON?.() ?? { error: err.message });
      }
    });

    // ── Project locks ───────────────────────────────────────
    app.get('/api/sdk/project-lock/:projectId/status', (req, res) => {
      const { projectId } = req.params;
      const locked = isLocked(projectId);
      const info: LockInfo | null = locked ? getLockInfo(projectId) : null;
      const age_ms: number | null = locked ? getLockAgeMs(projectId) : null;
      res.json({ locked, info, age_ms });
    });

    app.post('/api/sdk/project-lock/:projectId/acquire', (req, res) => {
      const { projectId } = req.params;
      const { holder, reason } = req.body as { holder?: string; reason?: string };
      if (!holder || !reason) {
        return res.status(400).json({ error: 'holder and reason are required' });
      }
      const success = acquireLock(projectId, holder, reason);
      res.json({ success });
    });

    app.post('/api/sdk/project-lock/:projectId/release', (req, res) => {
      const { projectId } = req.params;
      const { holder } = req.body as { holder?: string };
      if (!holder) {
        return res.status(400).json({ error: 'holder is required' });
      }
      const success = releaseLock(projectId, holder);
      res.json({ success });
    });

  }

  let server: ReturnType<typeof app.listen> | null = null;

  return {
    start() {
      return new Promise<void>((resolve) => {
        server = app.listen(config.port, '127.0.0.1', () => {
          if (server) {
            server.keepAliveTimeout = 10 * 60_000;
            server.headersTimeout = 10 * 60_000 + 1000;
            (server as any).requestTimeout = 0;
          }
          console.error(`[PolarClaw Web] Listening on http://127.0.0.1:${config.port}/mc/`);
          resolve();
        });
      });
    },
    stop() {
      server?.close();
    },
    app,
  };
}
