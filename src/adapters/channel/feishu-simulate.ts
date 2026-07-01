/**
 * 飞书链路 CLI 模拟器
 *
 * 用法：npm run feishu:simulate -- --user <userId> --chat <chatId> --text "消息"
 *
 * 模拟飞书消息到达的完整链路：
 * - 用户身份解析（通过 PolarPrivate resolveFeishuUser）
 * - 消息聚合 debounce
 * - 去重 dedup
 * - 文件下载（不模拟）
 *
 * 跳过签名验证、真实飞书 SDK 连接和 reply API。
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', '..', '..');

interface SimulateArgs {
  user: string;
  chat: string;
  text: string;
  bot?: string;
}

function parseArgs(): SimulateArgs {
  const argv = process.argv.slice(2);
  const args: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg.startsWith('--') && i + 1 < argv.length) {
      args[arg.slice(2)] = argv[i + 1]!;
      i++;
    }
  }

  if (!args.user) {
    console.error('Usage: npm run feishu:simulate -- --user <userId> --chat <chatId> --text "message"');
    console.error('  --user   用户 ID（模拟飞书 open_id）');
    console.error('  --chat   会话 ID（模拟飞书 chat_id）');
    console.error('  --text   消息文本');
    console.error('  --bot    Bot 类型: admin | rr（默认 admin）');
    process.exit(1);
  }

  return {
    user: args.user!,
    chat: args.chat || `sim-chat-${Date.now()}`,
    text: args.text || '',
    bot: args.bot || 'admin',
  };
}

async function main() {
  const args = parseArgs();

  if (!args.text && process.stdin.isTTY !== true) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    args.text = Buffer.concat(chunks).toString('utf8').trim();
  }

  if (!args.text) {
    console.error('Error: --text 必填，或通过管道输入文本');
    process.exit(1);
  }

  // 加载配置
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const { loadEnvFileEarly } = await import('../../config.js');
    loadEnvFileEarly();
  }

  const { loadSecretsToEnv } = await import('../privacy/secrets-loader.js');
  await loadSecretsToEnv({
    baseUrl: process.env.POLARPRIVATE_URL?.trim() || 'http://127.0.0.1:12790',
    projectName: 'PolarClaw',
  });

  const { loadConfig } = await import('../../config.js');
  const config = loadConfig();

  // 尝试解析用户身份
  let resolvedUserId = args.user;
  try {
    const { createPolarPrivateClient } = await import('../privacy/polar-private-client.js');
    const ppClient = createPolarPrivateClient({
      baseUrl: config.privacy.polarPrivateUrl,
    });
    const resolved = await ppClient.resolveFeishuUser(args.user);
    if (resolved) {
      resolvedUserId = resolved.user_id;
      console.error(`[feishu-simulate] 用户身份已解析: ${args.user} → ${resolved.username} (${resolved.user_id})`);
    } else {
      console.error(`[feishu-simulate] 未找到绑定，使用原始 user_id: ${args.user}`);
    }
  } catch (err) {
    console.error(`[feishu-simulate] PolarPrivate 不可用，使用原始 user_id: ${args.user}`, err);
  }

  // 构建 Agent（精简版，只要核心流程）
  const { createSqliteMemoryStore } = await import('../memory/sqlite-store.js');
  const { createPersistentConversation } = await import('../memory/persistent-conversation.js');
  const { createLLMRouter } = await import('../llm/llm-router.js');
  const { createToolExecutor } = await import('../tools/tool-executor.js');
  const { createPrivacyGateway } = await import('../privacy/privacy-gateway.js');
  const { createContextCompressor } = await import('../compression/summarizer.js');
  const { createSkillRegistry } = await import('../skills/skill-registry.js');
  const { createMetaIndex } = await import('../skills/meta-index.js');
  const { createLearningStore } = await import('../learning/feedback-store.js');
  const { createTrackedToolExecutor } = await import('../learning/usage-tracker.js');
  const { createAgent } = await import('../../core/agent.js');

  const { mkdirSync } = await import('node:fs');
  const { readFileSync } = await import('node:fs');
  const dataDir = dirname(config.memory.dbPath);
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });

  const memory = createSqliteMemoryStore(config.memory.dbPath);
  const conversations = createPersistentConversation({
    dbPath: config.memory.dbPath,
    maxMessages: config.memory.maxMessages,
    maxTokens: config.memory.maxTokens,
  });
  const llm = createLLMRouter({
    defaultTemperature: config.llm.temperature,
    defaultMaxTokens: config.llm.maxTokens,
    requestTimeoutMs: config.llm.requestTimeoutMs,
    concurrencyLimit: config.llm.concurrencyLimit,
  });
  const rawTools = createToolExecutor();
  const learningStore = createLearningStore(config.memory.dbPath);
  const tools = createTrackedToolExecutor(rawTools, learningStore);
  const privacy = createPrivacyGateway({
    polarPrivate: { baseUrl: config.privacy.polarPrivateUrl },
    enableSecretInterception: config.privacy.enableSecretInterception,
  });

  let soulPrompt = 'You are PolarClaw, a helpful AI assistant.';
  const soulEcosystemPath = join(config.projectRoot, 'PolarSkills', 'SOUL.md');
  const soulRootPath = join(config.projectRoot, 'worker.md');
  if (existsSync(soulEcosystemPath)) {
    const ecosystem = readFileSync(soulEcosystemPath, 'utf8');
    const identity = existsSync(soulRootPath) ? readFileSync(soulRootPath, 'utf8') : '';
    soulPrompt = identity ? `${identity}\n\n${ecosystem}` : ecosystem;
  } else if (existsSync(soulRootPath)) {
    soulPrompt = readFileSync(soulRootPath, 'utf8');
  }

  const metaIndex = createMetaIndex();
  metaIndex.scan(config.skills.scanDirs);
  const skillRegistry = createSkillRegistry(tools);
  await skillRegistry.init(config.skills.scanDirs, { loadTools: false });

  // 注册技能发现工具（让 Agent 能按需搜索和加载技能）
  const { createSkillDiscoveryTools } = await import('../skills/skill-discovery.js');
  const discoveryTools = createSkillDiscoveryTools({
    metaIndex,
    skillRegistry,
    polarisorRoot: join(config.projectRoot, '..'),
    localSkillDirs: config.skills.scanDirs,
  });
  for (const dt of discoveryTools) {
    tools.register(dt);
  }

  const skillCatalog = metaIndex.toPromptCatalog();
  const fullSystemPrompt = skillCatalog
    ? `${soulPrompt}\n\n${skillCatalog}`
    : soulPrompt;

  // Persona resolver（与 main.ts 共享逻辑）
  const personaDir = join(config.projectRoot, 'personas');
  function resolvePersona(userId: string): { content: string } {
    const candidates = [
      join(personaDir, `${userId}.md`),
      join(personaDir, 'default.md'),
    ];
    for (const p of candidates) {
      try {
        if (!existsSync(p)) continue;
        let raw = readFileSync(p, 'utf8');
        if (raw.includes('{{llm_model}}')) {
          raw = raw.replace(/\{\{llm_model\}\}/g, 'capability-based (QCSA)');
        }
        if (raw.includes('{{capabilities}}')) {
          const caps = [
            'ReAct 工具调用 + 多通道交互（飞书/CLI/Web）',
            '主动关怀与日程驱动调度',
            'YOLO 自主执行模式',
            'Web 控制台与文档审阅',
            '生态技能集成（AutoOffice/KnowLever/digist/ComputerUse 等 ' + tools.list().length + ' 个工具）',
            '元技能架构 + 自学习能力',
          ];
          raw = raw.replace(/\{\{capabilities\}\}/g, caps.map(c => `> - ${c}`).join('\n'));
        }
        return { content: raw };
      } catch { /* try next */ }
    }
    return { content: '' };
  }

  const compressor = createContextCompressor({
    triggerRatio: 0.7,
    toolOutputMaxLen: 2000,
    headKeep: 4,
    tailKeep: 8,
    summarize: async (text) => {
      const res = await llm.chat([
        { role: 'system', content: '请将以下多轮对话压缩为简洁摘要，保留关键事实。' },
        { role: 'user', content: text },
      ], { temperature: 0.3, maxTokens: 800 });
      return res.content ?? '';
    },
  });

  const agent = createAgent(
    {
      systemPrompt: fullSystemPrompt,
      personaResolver: resolvePersona,
      maxToolRounds: config.llm.maxToolRounds,
      temperature: config.llm.temperature,
      maxTokens: config.llm.maxTokens,
    },
    { llm, memory, conversations, tools, privacy, compressor },
  );

  // YOLO 自主执行引擎（强制所有任务走 YOLO 循环）
  const { createYoloEngine } = await import('../yolo/engine.js');
  const { createRecoveryStrategy } = await import('../yolo/recovery.js');
  const yoloEngine = createYoloEngine({
    agent,
    recovery: createRecoveryStrategy(),
    onStepComplete: (step, session) => {
      console.error(`[YOLO] 步骤 ${step.step}/${session.stepsCompleted} 完成 (${step.tokensUsed} tokens)`);
    },
    onEscalate: (_sessionId, message) => {
      console.error(`[YOLO] 需要用户介入: ${message}`);
    },
    async onAlignmentCheck(_sessionId, plan) {
      console.error(`[YOLO] 对齐计划:\n${plan.slice(0, 500)}`);
      console.error('[YOLO] 自动确认（feishu-simulate 模式）');
      return true; // 模拟模式自动确认
    },
  });

  // 模拟飞书消息处理流程
  const channelName = `feishu:${args.bot}`;
  const convId = `${channelName}:${resolvedUserId}`;

  console.error(`\n[feishu-simulate] 模拟参数:`);
  console.error(`  通道: ${channelName}`);
  console.error(`  用户: ${resolvedUserId} (原始: ${args.user})`);
  console.error(`  会话: ${args.chat}`);
  console.error(`  消息: ${args.text.slice(0, 100)}${args.text.length > 100 ? '...' : ''}\n`);

  tools.setContext(resolvedUserId, convId);

  try {
    // 通过 YOLO 引擎执行（强制 Plan → Execute 循环）
    const yoloResult = await yoloEngine.run(
      {
        projectId: 'feishu-simulate',
        goal: args.text,
        maxSteps: 20,
        maxTotalTokens: 5000000,
        maxWallTimeMs: 2000000,
        maxRetries: 5,
      },
      { channel: channelName, userId: resolvedUserId, conversationId: convId, projectId: 'feishu-simulate' },
    );

    const resultText = yoloResult.status === 'completed'
      ? `[YOLO 完成] ${yoloResult.steps.length} 步执行完毕\n\n${yoloResult.steps[yoloResult.steps.length - 1]?.text ?? ''}`
      : `[YOLO ${yoloResult.status}] ${yoloResult.stopReason ?? ''}`;

    console.log(`\nPolarClaw> ${resultText}\n`);
    console.error(`[feishu-simulate] YOLO 统计: ${yoloResult.stepsCompleted} 步, ${yoloResult.totalTokensUsed} tokens, ${Math.round(yoloResult.elapsedMs / 1000)}s`);
  } catch (err) {
    console.error('[feishu-simulate] 处理失败:', err);
    process.exit(1);
  }

  memory.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('[feishu-simulate] Fatal:', err);
  process.exit(1);
});
