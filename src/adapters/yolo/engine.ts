/**
 * YOLO 自主执行引擎适配器
 *
 * 实现 IYoloEngine 接口。
 * 外层循环驱动 Agent 核心多次执行，直到目标达成或预算耗尽。
 * 每步通过 Agent.handleMessage 注入续行 prompt，不修改 Agent 内部逻辑。
 */

import type {
  IYoloEngine,
  IYoloSessionState,
  IStepResult,
  IRecoveryStrategy,
} from '../../ports/autonomous.js';
import type { IHubAlignmentClient } from './hub-alignment.js';
import { acquireLock, releaseLock } from '../../sdk/project-lock.js';

export interface IYoloAgentHandle {
  handleMessage(
    channel: string,
    userId: string,
    text: string,
    conversationId?: string,
    projectId?: string,
  ): Promise<{ text: string; blocked: boolean; usage?: { totalTokens: number } }>;
}

export interface IYoloEngineDeps {
  agent: IYoloAgentHandle;
  recovery: IRecoveryStrategy;
  /** 步骤完成时的回调（可选，用于实时通知通道） */
  onStepComplete?: (step: IStepResult, session: IYoloSessionState) => void;
  /** 需要用户介入时的回调 */
  onEscalate?: (sessionId: string, message: string) => void;
  /** 对齐确认回调：向用户展示计划并等待确认。返回 true=确认，false=拒绝 */
  onAlignmentCheck?: (sessionId: string, plan: string) => Promise<boolean>;
  /** Hub alignment client for structured review (optional, falls back to heuristic) */
  hubAlignment?: IHubAlignmentClient;
}

const GOAL_REACHED_SIGNALS = [
  '目标已完成',
  '任务完成',
  'goal reached',
  'task completed',
  '已全部完成',
  '所有步骤完成',
  '已完成目标',
  'all done',
  'mission accomplished',
  '顺利完成',
  '执行完毕',
  'successfully completed',
];

/** Short responses with completion signals are high-confidence; long text with incidental mentions are not. */
function detectGoalReached(text: string): boolean {
  const lower = text.toLowerCase();
  const matched = GOAL_REACHED_SIGNALS.filter(s => lower.includes(s.toLowerCase()));
  if (matched.length === 0) return false;

  const SHORT_THRESHOLD = 300;
  if (text.length <= SHORT_THRESHOLD) return true;

  const lastSignalIdx = Math.max(
    ...matched.map(s => lower.lastIndexOf(s.toLowerCase())),
  );
  const tail = text.length - lastSignalIdx;
  return tail < SHORT_THRESHOLD;
}

function generateSessionId(): string {
  return `yolo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createYoloEngine(deps: IYoloEngineDeps): IYoloEngine {
  const sessions = new Map<string, IYoloSessionState>();
  const cancelTokens = new Set<string>();

  function buildAlignmentPrompt(goal: string): string {
    return [
      `[YOLO 对齐验证] 目标: ${goal}`,
      '',
      '在开始自主执行之前，请先完成对齐验证：',
      '',
      '第一步：判断输入类型',
      '- 如果目标是一个**完整方案**（包含具体步骤、技术路线、预期产物），回复 "INPUT_TYPE:PLAN"',
      '- 如果目标是一个**想法或需求**（需要你来拆解和规划），回复 "INPUT_TYPE:IDEA"',
      '',
      '第二步：无论哪种类型，都必须：',
      '1. 用一句话复述目标的核心要求',
      '2. 列出你计划执行的关键步骤（编号列表）',
      '3. 指出可能的风险或需要用户确认的前置条件',
      '',
      '以"对齐确认："开头回复。',
    ].join('\n');
  }

  const ALIGNMENT_SIGNALS = ['对齐确认', '目标理解', '计划如下', '步骤如下', '执行计划'];

  function verifyAlignment(text: string): boolean {
    const lower = text.toLowerCase();
    return ALIGNMENT_SIGNALS.some(s => lower.includes(s)) || text.includes('1.') || text.includes('1、');
  }

  function isCompletePlan(text: string): boolean {
    return text.includes('INPUT_TYPE:PLAN');
  }

  /**
   * Alignment Score: multi-dimensional plan quality assessment.
   * Combines heuristic checks with LLM judgment for robust scoring.
   */
  function computeAlignmentScore(goal: string, plan: string): {
    heuristicScore: number;
    dimensions: Record<string, { score: number; reason: string }>;
  } {
    const dimensions: Record<string, { score: number; reason: string }> = {};

    // Coverage: does the plan mention key terms from the goal?
    const goalTerms = goal.toLowerCase().split(/[\s,，。、]+/).filter(t => t.length > 2);
    const planLower = plan.toLowerCase();
    const covered = goalTerms.filter(t => planLower.includes(t)).length;
    const coverageRatio = goalTerms.length > 0 ? covered / goalTerms.length : 0;
    dimensions.coverage = {
      score: Math.min(coverageRatio * 1.2, 1),
      reason: `${covered}/${goalTerms.length} goal terms found in plan`,
    };

    // Structure: does the plan have numbered steps?
    const stepCount = (plan.match(/^\s*\d+[.、)]/gm) || []).length;
    dimensions.structure = {
      score: stepCount >= 3 ? 1 : stepCount >= 1 ? 0.6 : 0.2,
      reason: `${stepCount} numbered steps detected`,
    };

    // Specificity: plan length and detail level
    const wordCount = plan.split(/\s+/).length;
    dimensions.specificity = {
      score: wordCount > 200 ? 1 : wordCount > 50 ? 0.7 : 0.3,
      reason: `${wordCount} words in plan`,
    };

    // Risk awareness: mentions risks or caveats
    const riskTerms = ['风险', '注意', '前置条件', 'risk', 'caveat', '依赖', '限制'];
    const hasRisk = riskTerms.some(t => planLower.includes(t));
    dimensions.risk_awareness = {
      score: hasRisk ? 1 : 0.5,
      reason: hasRisk ? 'Risk/caveat awareness present' : 'No explicit risk discussion',
    };

    const heuristicScore = Object.values(dimensions).reduce((sum, d) => sum + d.score, 0) / Object.keys(dimensions).length;

    return { heuristicScore, dimensions };
  }

  /**
   * LLM-as-judge: Use a second LLM call to verify the alignment plan is
   * genuinely on-target, not just pattern-matching keywords.
   * Returns { aligned: boolean, reason: string, confidence: number }.
   */
  async function llmJudgeAlignment(
    goal: string,
    plan: string,
    llmCall: (prompt: string) => Promise<string>,
  ): Promise<{ aligned: boolean; reason: string; confidence: number }> {
    try {
      const judgePrompt = [
        '[LLM-as-Judge 对齐评估]',
        '',
        `原始目标: ${goal}`,
        '',
        `Agent 的执行计划:`,
        plan.slice(0, 2000),
        '',
        '请评估这个计划是否与原始目标对齐。回复 JSON:',
        '{"aligned": true/false, "reason": "一句话理由", "confidence": 0.0-1.0}',
        '',
        '评估标准:',
        '1. 计划是否覆盖了目标的核心要求？',
        '2. 步骤是否合理可行？',
        '3. 是否有遗漏关键方面？',
        '4. 是否存在明显偏离目标的步骤？',
      ].join('\n');

      const result = await llmCall(judgePrompt);
      const jsonMatch = result.match(/\{[\s\S]*?"aligned"[\s\S]*?\}/);
      if (!jsonMatch) return { aligned: true, reason: 'judge parse fallback', confidence: 0.5 };
      const parsed = JSON.parse(jsonMatch[0]) as { aligned: boolean; reason: string; confidence: number };
      return {
        aligned: Boolean(parsed.aligned),
        reason: String(parsed.reason || ''),
        confidence: Number(parsed.confidence) || 0.5,
      };
    } catch {
      return { aligned: true, reason: 'judge unavailable, defaulting to pass', confidence: 0.3 };
    }
  }

  function buildStepPrompt(goal: string, step: number, prevResult?: IStepResult): string {
    if (step === 1) {
      return [
        `[YOLO 自主模式] 目标: ${goal}`,
        '',
        '对齐验证已通过。现在开始自主执行第一步。',
        '每步执行完后报告进展。当所有步骤完成时，明确说"目标已完成"。',
        '如果遇到需要用户决策的问题，说"需要用户确认"并描述问题。',
      ].join('\n');
    }

    const lines = [
      `[YOLO 续行 - 步骤 ${step}]`,
      `目标: ${goal}`,
    ];

    if (prevResult?.error) {
      lines.push(`上一步出错: ${prevResult.error}`, '请尝试其他方式继续。');
    } else if (prevResult) {
      lines.push('上一步已完成，请继续执行下一步。如果目标已达成，请说"目标已完成"。');
    }

    return lines.join('\n');
  }

  return {
    async run(config, context) {
      const sessionId = config.sessionId ?? generateSessionId();
      const session: IYoloSessionState = {
        sessionId,
        status: 'running',
        stepsCompleted: 0,
        totalTokensUsed: 0,
        elapsedMs: 0,
        steps: [],
      };
      sessions.set(sessionId, session);

      const lockHolder = 'PolarClaw';
      const lockAcquired = acquireLock(config.projectId, lockHolder, 'YOLO task');
      if (!lockAcquired) {
        session.status = 'aborted';
        session.stopReason = '项目已被其他任务锁定';
        return session;
      }

      let releaseAndReturn = (s: IYoloSessionState): IYoloSessionState => {
        releaseLock(config.projectId, lockHolder);
        return s;
      };

      const startTime = Date.now();
      const convId = context.conversationId ?? `yolo:${context.userId}:${sessionId}`;

      // Step 0: Intent alignment — try Hub first, fall back to heuristic
      let useHubAlignment = false;
      let hubAlignmentId: string | undefined;

      if (deps.hubAlignment) {
        try {
          const available = await deps.hubAlignment.isAvailable();
          if (available) {
            const planPrompt = buildAlignmentPrompt(config.goal);
            const planResp = await deps.agent.handleMessage(
              context.channel, context.userId, planPrompt, convId,
            );
            session.totalTokensUsed += planResp.usage?.totalTokens ?? 0;

            const doc = await deps.hubAlignment.createAlignment(
              config.goal,
              planResp.text,
              ['对齐验证', '执行计划'],
            );

            if (doc) {
              hubAlignmentId = doc.id;
              useHubAlignment = true;

              deps.onStepComplete?.({
                step: 0,
                text: `Hub 对齐文档已创建 (${doc.id}), 等待审核...`,
                tokensUsed: planResp.usage?.totalTokens ?? 0,
                goalReached: false,
                durationMs: Date.now() - startTime,
              }, session);

              const decision = await deps.hubAlignment.waitForApproval(doc.id, 300_000);

              if (decision === 'rejected') {
                session.status = 'aborted';
                session.stopReason = 'Hub 审核拒绝';
                session.elapsedMs = Date.now() - startTime;
                return releaseAndReturn(session);
              }
              if (decision === 'timeout') {
                console.error('[YoloEngine] Hub 审核超时，降级到本地对齐');
                useHubAlignment = false;
              }

              session.steps.push({
                step: 0,
                text: `Hub 对齐${decision === 'approved' ? '通过' : '超时降级'}`,
                tokensUsed: planResp.usage?.totalTokens ?? 0,
                goalReached: false,
                durationMs: Date.now() - startTime,
              });
            }
          }
        } catch (err) {
          console.error('[YoloEngine] Hub alignment failed, falling back:', err);
        }
      }

      if (!useHubAlignment)
      try {
        const alignPrompt = buildAlignmentPrompt(config.goal);
        const alignResponse = await deps.agent.handleMessage(
          context.channel, context.userId, alignPrompt, convId,
        );
        const alignTokens = alignResponse.usage?.totalTokens ?? 0;
        session.totalTokensUsed += alignTokens;

        if (!verifyAlignment(alignResponse.text)) {
          // Degradation strategy: retry with simplified prompt before escalating
          const retryPrompt = `[简化对齐] 目标: ${config.goal}\n\n请用编号列表列出你打算执行的步骤。以"对齐确认："开头。`;
          const retryResp = await deps.agent.handleMessage(
            context.channel, context.userId, retryPrompt, convId,
          );
          session.totalTokensUsed += retryResp.usage?.totalTokens ?? 0;

          if (verifyAlignment(retryResp.text)) {
            // Retry succeeded — use retried plan
            Object.assign(alignResponse, retryResp);
          } else {
            session.status = 'escalated';
            session.stopReason = '对齐验证未通过（含降级重试）：Agent 可能未正确理解目标';
            session.elapsedMs = Date.now() - startTime;
            session.steps.push({
              step: 0, text: alignResponse.text, tokensUsed: alignTokens,
              goalReached: false, error: '对齐验证未通过', durationMs: Date.now() - startTime,
            });
            deps.onEscalate?.(sessionId, `对齐验证未通过（含降级重试），Agent 回复: ${retryResp.text.slice(0, 200)}`);
            return releaseAndReturn(session);
          }
        }

        // Alignment scoring: heuristic + LLM-as-judge
        const heuristicResult = computeAlignmentScore(config.goal, alignResponse.text);
        const judgeVerdict = heuristicResult.heuristicScore < 0.3
          ? { aligned: false, reason: `Heuristic score too low: ${heuristicResult.heuristicScore.toFixed(2)}`, confidence: 0.8 }
          : await llmJudgeAlignment(
              config.goal,
              alignResponse.text,
              async (prompt) => {
                const resp = await deps.agent.handleMessage(context.channel, context.userId, prompt, convId);
                session.totalTokensUsed += resp.usage?.totalTokens ?? 0;
                return resp.text;
              },
            );

        const finalScore = heuristicResult.heuristicScore * 0.4 + (judgeVerdict.aligned ? 1 : 0) * judgeVerdict.confidence * 0.6;

        if (!judgeVerdict.aligned && judgeVerdict.confidence > 0.6) {
          // Degradation: if heuristic score is decent, allow with warning
          if (heuristicResult.heuristicScore > 0.5) {
            deps.onStepComplete?.({
              step: 0,
              text: `⚠️ 降级放行: LLM judge 不通过但启发式评分尚可 (${heuristicResult.heuristicScore.toFixed(2)})`,
              tokensUsed: alignTokens,
              goalReached: false,
              durationMs: Date.now() - startTime,
            }, session);
          } else {
            session.status = 'escalated';
            session.stopReason = `对齐评分不足 (score=${finalScore.toFixed(2)}, heuristic=${heuristicResult.heuristicScore.toFixed(2)}): ${judgeVerdict.reason}`;
            session.elapsedMs = Date.now() - startTime;
            session.steps.push({
              step: 0, text: alignResponse.text, tokensUsed: alignTokens,
              goalReached: false, error: judgeVerdict.reason, durationMs: Date.now() - startTime,
            });
            deps.onEscalate?.(sessionId, `对齐评分 ${finalScore.toFixed(2)}: ${judgeVerdict.reason}`);
            return releaseAndReturn(session);
          }
        }

        // LLM auto-decides: complete plan → auto-proceed; idea → require user confirmation
        const needsUserConfirm = !isCompletePlan(alignResponse.text);

        if (needsUserConfirm && deps.onAlignmentCheck) {
          const userConfirmed = await deps.onAlignmentCheck(sessionId, alignResponse.text);
          if (!userConfirmed) {
            session.status = 'aborted';
            session.stopReason = '用户拒绝执行计划';
            session.elapsedMs = Date.now() - startTime;
            session.steps.push({
              step: 0, text: alignResponse.text, tokensUsed: alignTokens,
              goalReached: false, error: '用户拒绝', durationMs: Date.now() - startTime,
            });
            return releaseAndReturn(session);
          }
        }

        session.steps.push({
          step: 0, text: alignResponse.text, tokensUsed: alignTokens,
          goalReached: false, durationMs: Date.now() - startTime,
        });
        deps.onStepComplete?.({
          step: 0,
          text: needsUserConfirm ? '对齐验证通过（用户确认）' : '对齐验证通过（完整方案，自动放行）',
          tokensUsed: alignTokens, goalReached: false, durationMs: Date.now() - startTime,
        }, session);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        session.status = 'aborted';
        session.stopReason = `对齐验证失败: ${msg}`;
        session.elapsedMs = Date.now() - startTime;
        return releaseAndReturn(session);
      }

      let prevResult: IStepResult | undefined;

      for (let step = 1; step <= config.maxSteps; step++) {
        if (cancelTokens.has(sessionId)) {
          session.status = 'aborted';
          session.stopReason = '用户取消';
          break;
        }

        const elapsed = Date.now() - startTime;
        if (elapsed > config.maxWallTimeMs) {
          session.status = 'aborted';
          session.stopReason = `超时 (${Math.round(elapsed / 1000)}s)`;
          break;
        }

        if (session.totalTokensUsed >= config.maxTotalTokens) {
          session.status = 'aborted';
          session.stopReason = `Token 预算耗尽 (${session.totalTokensUsed}/${config.maxTotalTokens})`;
          break;
        }

        const prompt = buildStepPrompt(config.goal, step, prevResult);
        const stepStart = Date.now();
        let retriesSoFar = 0;
        let stepResult: IStepResult | null = null;

        while (retriesSoFar <= config.maxRetries) {
          try {
            const response = await deps.agent.handleMessage(
              context.channel,
              context.userId,
              prompt,
              convId,
            );

            const tokensUsed = response.usage?.totalTokens ?? 0;
            stepResult = {
              step,
              text: response.text,
              tokensUsed,
              goalReached: detectGoalReached(response.text),
              durationMs: Date.now() - stepStart,
            };
            break;
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            const action = deps.recovery.decide(error, {
              step,
              retriesSoFar,
              maxRetries: config.maxRetries,
              goal: config.goal,
            });

            switch (action.type) {
              case 'retry':
                retriesSoFar++;
                await sleep(Math.min(1000 * 2 ** retriesSoFar, 30000));
                continue;

              case 'skip':
                stepResult = {
                  step,
                  text: action.reason,
                  tokensUsed: 0,
                  goalReached: false,
                  error: action.reason,
                  durationMs: Date.now() - stepStart,
                };
                break;

              case 'escalate':
                session.status = 'escalated';
                session.stopReason = action.message;
                deps.onEscalate?.(sessionId, action.message);
                stepResult = {
                  step,
                  text: action.message,
                  tokensUsed: 0,
                  goalReached: false,
                  error: action.message,
                  durationMs: Date.now() - stepStart,
                };
                break;

              case 'abort':
                session.status = 'aborted';
                session.stopReason = action.reason;
                stepResult = {
                  step,
                  text: action.reason,
                  tokensUsed: 0,
                  goalReached: false,
                  error: action.reason,
                  durationMs: Date.now() - stepStart,
                };
                break;
            }
            break;
          }
        }

        if (stepResult) {
          session.steps.push(stepResult);
          session.stepsCompleted = step;
          session.totalTokensUsed += stepResult.tokensUsed;
          session.elapsedMs = Date.now() - startTime;
          prevResult = stepResult;
          deps.onStepComplete?.(stepResult, session);

          if (useHubAlignment && deps.hubAlignment) {
            deps.hubAlignment.reportProgress(
              step,
              stepResult.goalReached
                ? `步骤 ${step} 完成 — 目标已达成`
                : `步骤 ${step} 完成 (${stepResult.tokensUsed} tokens)`,
            ).catch(() => {});
          }

          if (stepResult.goalReached) {
            session.status = 'completed';
            if (useHubAlignment && hubAlignmentId && deps.hubAlignment) {
              deps.hubAlignment.completeAlignment(hubAlignmentId).catch(() => {});
            }
            break;
          }

          if (stepResult.text.includes('需要用户确认')) {
            session.status = 'escalated';
            session.stopReason = '需要用户决策';
            deps.onEscalate?.(sessionId, stepResult.text);
            break;
          }
        }

        if (session.status !== 'running') break;
      }

      if (session.status === 'running') {
        session.status = 'aborted';
        session.stopReason = `达到最大步数 (${config.maxSteps})`;
      }

      session.elapsedMs = Date.now() - startTime;
      return releaseAndReturn(session);
    },

    cancel(sessionId) {
      cancelTokens.add(sessionId);
    },

    getSession(sessionId) {
      return sessions.get(sessionId) ?? null;
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
