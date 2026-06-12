/**
 * SDK computer-use module — sandbox-external ComputerUse service
 *
 * Other Polarisor projects (Project Lobsters) call PolarClaw via the
 * thin polarclaw-project-sdk client; the corresponding server-side
 * module lives here. ComputerUse stays owned by PolarClaw — no other
 * project ever runs Chromium itself.
 *
 * Same module is reused by skills/computer-use/tools.ts so the in-
 * process ReAct agent and the SDK call site share a single Stagehand
 * adapter (no duplicate behaviour drifts).
 *
 * Stagehand v3 API surface (browserbasehq/stagehand@^3.x):
 *   - new Stagehand(opts): instance with init/close + act/observe/extract
 *   - stagehand.context.newPage(url?): Promise<Page>
 *   - stagehand.context.activePage(): Page | undefined
 *   - page.goto(url) / page.screenshot({path, fullPage}) / page.url() / page.title()
 *   - stagehand.observe(instruction?): Promise<Action[]>
 *
 * LLM routing (PolarPrivate by default):
 *   By default we send Stagehand's internal LLM calls through
 *   PolarPrivate's OpenAI-compatible /v1 gateway, so no external
 *   OPENAI_API_KEY is required and all traffic stays inside the
 *   Polarisor network. Override via env vars when needed.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve, join, extname } from 'node:path';
import { homedir } from 'node:os';

const SCREENSHOT_DIR = resolve(homedir(), 'Polarisor/PolarClaw/data/screenshots');

function ensureScreenshotDir(): void {
  if (!existsSync(SCREENSHOT_DIR)) {
    mkdirSync(SCREENSHOT_DIR, { recursive: true });
  }
}

function envOr(key: string, fallback: string): string {
  const v = process.env[key];
  return v && v.trim() ? v.trim() : fallback;
}

/**
 * Same as envOr, but treats 'proxy-managed' as a sentinel placeholder
 * (PolarClaw uses it to mean "no real key set; let the proxy figure
 * it out"). For ComputerUse we need a *real* PolarPrivate Bearer
 * token, so a placeholder must not shadow the next fallback.
 */
function envOrReal(key: string, fallback: string): string {
  const v = process.env[key];
  if (!v) return fallback;
  const trimmed = v.trim();
  if (!trimmed || trimmed === 'proxy-managed') return fallback;
  return trimmed;
}

/**
 * Build LLM credentials for Stagehand to consume.
 *
 * Resolution order for each field:
 *   baseURL : COMPUTER_USE_LLM_BASE_URL >
 *             POLARPRIVATE_URL/v1 (PolarPrivate's standard
 *             OpenAI-compatible gateway; this requires no
 *             PolarClaw-side token injection middleware).
 *
 *             NOTE: POLARCLAW_LLM_BASE_URL is intentionally NOT in
 *             the fallback chain. That env var points at PolarClaw's
 *             internal proxy convention (`/proxy/<service>/...`) which
 *             expects the PolarClaw process to swap 'proxy-managed' for
 *             a real upstream token at request time. Our SDK module
 *             runs anywhere — including in subprocesses or in foreign
 *             projects via polarclaw-project-sdk — so it must talk to
 *             PolarPrivate over the public /v1 surface where any
 *             valid PolarPrivate Bearer is accepted.
 *
 *   apiKey  : COMPUTER_USE_LLM_API_KEY > POLARPRIVATE_SERVICE_TOKEN >
 *             POLARCLAW_LLM_API_KEY > 'proxy-managed' (last-resort
 *             placeholder; PolarPrivate will return 401 in that
 *             case, but screenshot() paths skip the LLM entirely
 *             so they remain usable). 'proxy-managed' is treated as
 *             a sentinel — it never shadows a real token.
 *
 *   modelName: COMPUTER_USE_MODEL_NAME > 'openai/qwen-plus'. The
 *             provider/model prefix is required by Stagehand v3; the
 *             segment after "openai/" is what we send as the actual
 *             model name to PolarPrivate.
 */
function resolveLLMCreds() {
  const polarPrivateUrl = envOr('POLARPRIVATE_URL', 'http://127.0.0.1:12790');
  const baseURL = envOr('COMPUTER_USE_LLM_BASE_URL', `${polarPrivateUrl}/v1`);
  const apiKey = envOrReal(
    'COMPUTER_USE_LLM_API_KEY',
    envOrReal(
      'POLARPRIVATE_SERVICE_TOKEN',
      envOrReal('POLARCLAW_LLM_API_KEY', 'proxy-managed'),
    ),
  );
  // Default to qwen3-coder-plus via DashScope codingplan proxy. The 'openai/'
  // prefix is required by Stagehand's model validation (provider/model format).
  // NOTE: COMPUTER_USE_MODEL_NAME should be set to 'openai/qwen3-coder-plus' in .env.
  const modelName = envOr('COMPUTER_USE_MODEL_NAME', 'openai/qwen3-coder-plus');
  return { modelName, apiKey, baseURL };
}

/**
 * fetch interceptor that rewrites Stagehand v3 chat-completions
 * requests so they survive PolarPrivate's stricter OpenAI-compat
 * upstreams (Aliyun qwen, MiniMax, etc.).
 *
 * Two known incompatibilities are fixed in-flight:
 *   1. Stagehand emits the new `developer` role (OpenAI o1/GPT-5
 *      convention); qwen / MiniMax only accept the legacy
 *      `system/user/assistant/tool/function` set. We rewrite
 *      `developer` -> `system`.
 *   2. Stagehand's tool/JSON-schema requests sometimes include
 *      `$schema` / `additionalProperties` keys that some upstreams
 *      reject. We strip the JSON-schema dialect indicator if present.
 *
 * Anything else is passed through untouched. This keeps the LLMClient
 * portable when PolarPrivate later adds richer routing.
 */
const compatFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input);

  // Intercept ALL requests to PolarPrivate's LLM gateway:
  // 1. Strip 'Bearer proxy-managed' → send without auth (PolarPrivate allows anonymous MiniMax)
  // 2. Rewrite /v1/responses → /v1/chat/completions (PolarPrivate only has Chat Completions API)
  // 3. Transform Responses API request body → Chat Completions body
  const isPolarPrivate = url.includes('127.0.0.1:12790');
  if (init?.headers && isPolarPrivate) {
    const headers = init.headers;
    let authHeader: string | null = null;
    if (headers instanceof Headers) {
      authHeader = headers.get('authorization');
    } else if (typeof headers === 'object' && headers !== null) {
      authHeader = (headers as Record<string, string>)['Authorization']
        ?? (headers as Record<string, string>)['authorization']
        ?? null;
    }

    // Build clean headers without the bad auth token
    const cleanHeaders: Record<string, string> = {};
    if (headers instanceof Headers) {
      headers.forEach((v, k) => { if (k.toLowerCase() !== 'authorization') cleanHeaders[k] = v; });
    } else if (typeof headers === 'object' && headers !== null) {
      for (const [k, v] of Object.entries(headers as Record<string, string>)) {
        if (k.toLowerCase() !== 'authorization') cleanHeaders[k] = v;
      }
    }

    // Rewrite URL: /v1/responses → /v1/chat/completions
    const needsRewrite = url.includes('/v1/responses');
    const rewrittenUrl = needsRewrite
      ? url.replace('/v1/responses', '/v1/chat/completions')
      : url;

    // Build forwarded init
    let forwardedInit: RequestInit = {
      ...init,
      headers: cleanHeaders,
    };

    // Transform body if rewriting responses → chat/completions
    if (needsRewrite && typeof init?.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        // Responses API: { model, input: [{role, content}], tools?, ...
        // Chat Completions API: { model, messages: [{role, content}], tools?, ...
        const chatBody: Record<string, unknown> = {
          model: body.model,
          messages: Array.isArray(body.input)
            ? body.input.map((item: { role?: string; content?: string; text?: string }) => ({
                role: item.role === 'user' ? 'user' : item.role === 'assistant' ? 'assistant' : 'user',
                content: item.content ?? item.text ?? '',
              }))
            : [{ role: 'user', content: String(body.input ?? '') }],
          tools: body.tools,
          stream: false,
        };
        // Strip response_format.json_schema (full JSON Schema definition) and replace
        // with simple json_object. DashScope/qwen do not support the full JSON Schema
        // format that Stagehand sends; the simpler type is sufficient.
        if (body.response_format != null) {
          const rf = body.response_format as Record<string, unknown>;
          if (rf?.json_schema != null) {
            chatBody.response_format = { type: 'json_object' };
          } else {
            chatBody.response_format = rf;
          }
        }
        forwardedInit = { ...forwardedInit, body: JSON.stringify(chatBody) };
      } catch {
        // body transformation failed; send as-is
      }
    }

    // Only intercept if auth is bad or URL needs rewriting
    if (authHeader === 'Bearer proxy-managed' || needsRewrite) {
      console.error('[compatFetch] forwarding to', rewrittenUrl.replace('http://127.0.0.1:12790', ''), 'body snippet:', String(forwardedInit.body || '').slice(0, 200));
      return fetch(rewrittenUrl, forwardedInit);
    }
  }

  if (init?.body && typeof init.body === 'string') {
    try {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      let mutated = false;

      const messages = body.messages;
      if (Array.isArray(messages)) {
        for (const msg of messages as Array<Record<string, unknown>>) {
          if (msg.role === 'developer') {
            msg.role = 'system';
            mutated = true;
          }
        }
      }

      const responseFormat = body.response_format as Record<string, unknown> | undefined;
      if (responseFormat?.json_schema) {
        const js = responseFormat.json_schema as Record<string, unknown>;
        const schema = js.schema as Record<string, unknown> | undefined;
        if (schema && '$schema' in schema) {
          delete schema.$schema;
          mutated = true;
        }
      }

      if (mutated) {
        init = { ...init, body: JSON.stringify(body) };
      }
    } catch {
      // body wasn't JSON; pass through unchanged
    }
  }

  const res = await fetch(input, init);

  // Strip <think>...</think> reasoning blocks from chat-completion
  // responses. PolarPrivate's MiniMax/qwen backends emit thinking
  // inline in `choices[i].message.content`; Stagehand v3's JSON-mode
  // parser cannot parse `<think>...</think>{"action":...}`. Streaming
  // is left untouched (Stagehand's createChatCompletion path uses
  // non-streaming requests, so this is safe). 404/500 etc. also pass
  // through untouched.
  const contentType = res.headers.get('content-type') ?? '';
  if (
    res.ok &&
    contentType.includes('application/json') &&
    typeof input === 'string' &&
    input.includes('chat/completions')
  ) {
    try {
      const json = await res.clone().json() as Record<string, unknown>;
      let mutated = false;
      const choices = json.choices as Array<{ message?: { content?: unknown; reasoning_content?: unknown } }> | undefined;
      if (Array.isArray(choices)) {
        for (const choice of choices) {
          const msg = choice.message;
          if (msg && typeof msg.content === 'string') {
            // 1. Strip <think>...</think> thinking blocks (MiniMax-M2.7-highspeed)
            let stripped = msg.content.replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim();
            // 2. Strip markdown code fences (qwen-plus sometimes wraps JSON in ```json ... ```)
            stripped = stripped.replace(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i, '$1').trim();
            if (stripped !== msg.content) {
              msg.content = stripped;
              mutated = true;
            }
          }
        }
      }
      if (mutated) {
        if (process.env.COMPUTER_USE_DEBUG === '1') {
          console.error('[compatFetch] stripped <think> from chat response');
        }
        return new Response(JSON.stringify(json), {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        });
      }
    } catch {
      // response wasn't valid JSON or already consumed; ignore
    }
  }

  return res;
};

/**
 * Build a Stagehand LLMClient that goes through the legacy OpenAI
 * /v1/chat/completions endpoint instead of the new /v1/responses one,
 * and that survives the small payload incompatibilities listed in
 * compatFetch above.
 *
 * Why this matters:
 *   Stagehand v3's default LLMProvider feeds the modelName through
 *   ai-sdk-openai's `createOpenAI(opts)(modelId)` shorthand, which
 *   resolves to the Responses API. PolarPrivate only serves
 *   /v1/chat/completions today, so the default path 405's. We sidestep
 *   the provider shorthand by calling provider.chat(modelId) explicitly
 *   and then wrapping that LanguageModelV2 in Stagehand's AISdkClient
 *   so the rest of v3 (act/observe handlers) still works unchanged.
 */
async function buildChatCompletionsLLMClient() {
  const { AISdkClient } = await import('@browserbasehq/stagehand') as unknown as {
    AISdkClient: new (opts: { model: unknown; logger?: () => void }) => unknown;
  };
  const aiSdkOpenAI = await import('@ai-sdk/openai') as unknown as {
    createOpenAI: (opts: { baseURL: string; apiKey: string; fetch?: typeof fetch }) => {
      chat: (modelId: string) => unknown;
    };
  };

  const { modelName, apiKey, baseURL } = resolveLLMCreds();
  const subModel = modelName.includes('/') ? modelName.slice(modelName.indexOf('/') + 1) : modelName;
  const provider = aiSdkOpenAI.createOpenAI({ baseURL, apiKey, fetch: compatFetch });
  const chatModel = provider.chat(subModel);
  return new AISdkClient({ model: chatModel, logger: () => { /* swallow stagehand logs */ } });
}

interface StagehandPage {
  goto(url: string, opts?: { waitUntil?: string; timeoutMs?: number }): Promise<unknown>;
  screenshot(opts?: { path?: string; fullPage?: boolean }): Promise<Buffer>;
  url(): string;
  title(): Promise<string>;
}

interface StagehandContext {
  newPage(url?: string): Promise<StagehandPage>;
  activePage(): StagehandPage | undefined;
}

interface StagehandInstance {
  init(): Promise<void>;
  context: StagehandContext;
  act(instruction: string, opts?: Record<string, unknown>): Promise<{ success: boolean; message?: string }>;
  observe(instruction?: string, opts?: Record<string, unknown>): Promise<Array<{ description?: string; selector?: string }>>;
  close(opts?: { force?: boolean }): Promise<void>;
}

interface StagehandModule {
  Stagehand: new (opts: Record<string, unknown>) => StagehandInstance;
}

async function getStagehand(): Promise<StagehandModule | null> {
  try {
    const mod = await import('@browserbasehq/stagehand');
    return mod as unknown as StagehandModule;
  } catch {
    return null;
  }
}

async function withBrowser<T>(
  fn: (instance: StagehandInstance) => Promise<T>,
  opts?: { needLLM?: boolean },
): Promise<T> {
  const mod = await getStagehand();
  if (!mod) {
    throw new Error(
      'Stagehand 未安装。请在 PolarClaw 容器或主机运行: npm install @browserbasehq/stagehand playwright',
    );
  }

  const stagehandOpts: Record<string, unknown> = {
    env: 'LOCAL',
    localBrowserLaunchOptions: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    },
    // Help upstream models satisfy response_format json_schema contracts.
    // Some providers (e.g. qwen via PolarPrivate) reject schema mode
    // unless prompts explicitly mention JSON.  Also, MiniMax-M2.7-highspeed
    // sometimes emits <think> blocks before the JSON; the explicit
    // prohibition below prevents this in most cases.
    systemPrompt:
      'You are a browser action planner. ' +
      'IMPORTANT: Always output strict JSON only. Do not use markdown (no ```). ' +
      'Do not include any <think> or </think> reasoning blocks. ' +
      'The word "json" must appear in your response. ' +
      'Begin directly with the JSON object.',
    verbose: 0,
    disablePino: true,
  };

  // Only build the LLM client when act/observe is actually going to be
  // called — pure screenshot / goto paths must work without any LLM key.
  if (opts?.needLLM) {
    try {
      stagehandOpts.llmClient = await buildChatCompletionsLLMClient();
    } catch (err) {
      throw new Error(
        `无法构造 ComputerUse LLM client: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    // Stagehand still requires *some* model config at construction time
    // for type validation; pass a no-call placeholder. It won't be invoked
    // because we never call act/observe in screenshot-only paths.
    const { modelName, apiKey, baseURL } = resolveLLMCreds();
    stagehandOpts.model = { modelName, apiKey, baseURL };
  }

  const instance = new mod.Stagehand(stagehandOpts);

  await instance.init();
  try {
    return await fn(instance);
  } finally {
    try { await instance.close({ force: true }); } catch { /* swallow close errors */ }
  }
}

/**
 * Acquire a Page in v3 — newPage() each call ensures the URL is loaded
 * even on the first invocation; v3 does not auto-create a page.
 */
async function ensurePage(stagehand: StagehandInstance, url: string): Promise<StagehandPage> {
  const existing = stagehand.context.activePage();
  if (existing) {
    await existing.goto(url);
    return existing;
  }
  return stagehand.context.newPage(url);
}

// ---------------------------------------------------------------------------
// VLM (Vision Language Model) — Ollama MLX (qwen3-vl:8b)
// ---------------------------------------------------------------------------

const VLM_URL = envOr('COMPUTER_USE_VLM_URL', 'http://localhost:11434/v1');
const VLM_MODEL = envOr('COMPUTER_USE_VLM_MODEL', 'qwen3-vl:8b');

const VLM_DEFAULT_PROMPT =
  '请分析这个网页截图。描述页面的主要内容、布局结构、所有可见的交互元素（按钮、链接、输入框等）及其当前状态。如果有文字内容，请提取关键文本。用中文回答。';

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

async function analyzeWithVLM(
  imagePath: string,
  prompt?: string,
): Promise<string> {
  const ext = extname(imagePath).toLowerCase();
  const mime = IMAGE_MIME[ext] ?? 'image/png';
  const b64 = readFileSync(imagePath).toString('base64');

  const body = {
    model: VLM_MODEL,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt || VLM_DEFAULT_PROMPT },
          { type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } },
        ],
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
    clearTimeout(timer);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`VLM ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content?.trim() ?? '(VLM 无输出)';
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------

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
  screenshot?: string;
  error?: string;
}

export interface ComputerUseScreenshotInput {
  url: string;
  full_page?: boolean;
  observe?: boolean;
  /** Timeout for observe() in ms. Default 60000 (60s). Complex pages need more time for accessibility snapshot. */
  observe_timeout_ms?: number;
  /** Send screenshot to local VLM (Gemma 27B via llama.cpp) for content understanding/OCR. */
  analyze?: boolean;
  /** Custom prompt for VLM analysis. Default provides general page understanding + OCR. */
  analyze_prompt?: string;
}

export interface ComputerUseScreenshotResult {
  ok: boolean;
  screenshot?: string;
  page_url?: string;
  page_title?: string;
  elements?: Array<{ description?: string; selector?: string }>;
  /** VLM analysis of the screenshot content (when analyze:true). */
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
  screenshot?: string;
  error?: string;
}

export async function browse(input: ComputerUseBrowseInput): Promise<ComputerUseBrowseResult> {
  const url = (input.url ?? '').toString();
  const action = (input.action ?? '').toString();
  const takeScreenshot = input.screenshot !== false;

  if (!url || !action) {
    return { ok: false, error: 'url 和 action 都是必填' };
  }

  try {
    return await withBrowser(async (stagehand) => {
      const page = await ensurePage(stagehand, url);
      const actionResult = await stagehand.act(action);

      let screenshotPath: string | undefined;
      if (takeScreenshot) {
        ensureScreenshotDir();
        const filename = `cu-browse-${Date.now()}.png`;
        screenshotPath = join(SCREENSHOT_DIR, filename);
        await page.screenshot({ path: screenshotPath });
      }

      return {
        ok: true,
        action_result: actionResult,
        page_url: page.url(),
        page_title: await page.title(),
        screenshot: screenshotPath,
      };
    }, { needLLM: true });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function screenshot(input: ComputerUseScreenshotInput): Promise<ComputerUseScreenshotResult> {
  const url = (input.url ?? '').toString();
  const fullPage = Boolean(input.full_page);
  const doObserve = Boolean(input.observe);
  const doAnalyze = Boolean(input.analyze);

  if (!url) return { ok: false, error: 'url 必填' };

  try {
    return await withBrowser(async (stagehand) => {
      const page = await ensurePage(stagehand, url);
      ensureScreenshotDir();
      const filename = `cu-screenshot-${Date.now()}.png`;
      const screenshotPath = join(SCREENSHOT_DIR, filename);
      await page.screenshot({ path: screenshotPath, fullPage });

      let elements: Array<{ description?: string; selector?: string }> | undefined;
      if (doObserve) {
        const observeTimeoutMs = (input as { observe_timeout_ms?: number }).observe_timeout_ms ?? 60000;
        elements = await stagehand.observe('列出页面上所有可交互元素', { timeout: observeTimeoutMs });
      }

      let analysis: string | undefined;
      if (doAnalyze) {
        try {
          analysis = await analyzeWithVLM(screenshotPath, input.analyze_prompt);
        } catch (err) {
          analysis = `[VLM error: ${err instanceof Error ? err.message : String(err)}]`;
        }
      }

      return {
        ok: true,
        screenshot: screenshotPath,
        page_url: page.url(),
        page_title: await page.title(),
        elements,
        analysis,
      };
    }, { needLLM: doObserve });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function fillForm(input: ComputerUseFillFormInput): Promise<ComputerUseFillFormResult> {
  const url = (input.url ?? '').toString();
  const fields = input.fields;
  const submit = Boolean(input.submit);

  if (!url || !fields || typeof fields !== 'object') {
    return { ok: false, error: 'url 和 fields 都是必填' };
  }

  try {
    return await withBrowser(async (stagehand) => {
      const page = await ensurePage(stagehand, url);
      const results: Array<{ field: string; success: boolean; message?: string }> = [];

      for (const [fieldDesc, value] of Object.entries(fields)) {
        const r = await stagehand.act(`在"${fieldDesc}"字段中输入"${value}"`);
        results.push({ field: fieldDesc, success: r.success, message: r.message });
      }

      if (submit) {
        const submitResult = await stagehand.act('点击提交按钮或确认按钮');
        results.push({ field: '__submit__', success: submitResult.success, message: submitResult.message });
      }

      ensureScreenshotDir();
      const filename = `cu-form-${Date.now()}.png`;
      const screenshotPath = join(SCREENSHOT_DIR, filename);
      await page.screenshot({ path: screenshotPath });

      return {
        ok: true,
        results,
        page_url: page.url(),
        screenshot: screenshotPath,
      };
    }, { needLLM: true });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function createComputerUseModule() {
  return {
    browse,
    screenshot,
    fillForm,
  };
}

export type ComputerUseModule = ReturnType<typeof createComputerUseModule>;
