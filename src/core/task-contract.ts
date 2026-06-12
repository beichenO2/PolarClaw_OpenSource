/**
 * TaskContract — 任务契约系统
 *
 * 独立于对话历史的持久化结构，在每轮 LLM 调用时注入 system prompt 的固定区域，
 * 永远不会被上下文压缩影响。解决灾难性遗忘和逻辑链不完整问题。
 *
 * 生命周期：用户消息 → 约束提取 → 步骤规划 → 每轮注入 → 步骤验收 → 完成
 */

// ─── 类型定义 ───

export type ConstraintCategory = 'format' | 'process' | 'content' | 'tool' | 'output' | 'other';
export type ConstraintSource = 'user' | 'ecosystem';
export type StepStatus = 'pending' | 'in_progress' | 'done' | 'failed';

export interface Constraint {
  id: string;
  source: ConstraintSource;
  text: string;
  category: ConstraintCategory;
  verifiable: boolean;
  verifyHint?: string;
}

export interface TaskStep {
  index: number;
  description: string;
  status: StepStatus;
  dependsOn: number[];
  output?: string;
}

export interface TaskContract {
  id: string;
  createdAt: string;
  constraints: Constraint[];
  ecoConstraints: Constraint[];
  steps: TaskStep[];
  currentStepIndex: number;
  artifacts: string[];
  /** true = contract 已验收完成 */
  completed: boolean;
}

/** LLM 返回的约束提取结果 */
interface ExtractedPlan {
  constraints: Array<{
    text: string;
    category: ConstraintCategory;
    verifiable: boolean;
    verifyHint?: string;
  }>;
  steps: Array<{
    description: string;
    dependsOn: number[];
  }>;
  artifacts: string[];
}

// ─── 约束提取 ───

const EXTRACT_PROMPT = `你是一个任务分析器。从用户消息中提取所有硬约束和步骤分解。

规则：
1. 硬约束是用户明确要求的、不可违反的规则（格式、模板、规范、流程、工具选择等）
2. 步骤分解要将抽象任务分解为有序的、可执行的具体步骤
3. 每个步骤要有明确的预期产出
4. 如果任务很简单（问答、闲聊），返回空约束和单步骤

输出严格 JSON，不加 markdown 标记：
{
  "constraints": [
    {"text": "约束描述", "category": "format|process|content|tool|output|other", "verifiable": true, "verifyHint": "如何验证"}
  ],
  "steps": [
    {"description": "步骤描述", "dependsOn": []}
  ],
  "artifacts": ["预期产出物描述"]
}`;

/**
 * 从用户消息中提取约束和步骤。
 * 使用传入的 LLM chat 函数，调用速度档模型。
 */
export async function extractContractFromMessage(
  userMessage: string,
  llmChat: (messages: Array<{ role: string; content: string }>, opts?: { capability?: string }) => Promise<{ content: string | null }>,
): Promise<ExtractedPlan> {
  const fallback: ExtractedPlan = { constraints: [], steps: [{ description: '直接回答用户', dependsOn: [] }], artifacts: [] };

  try {
    const result = await llmChat(
      [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: userMessage },
      ],
      { capability: '001' },
    );

    const raw = (result.content ?? '').trim();
    const stripped = raw.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    const noFence = stripped.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();

    // Extract first valid JSON object from the response
    const jsonStart = noFence.indexOf('{');
    if (jsonStart === -1) return fallback;
    let depth = 0;
    let jsonEnd = -1;
    for (let i = jsonStart; i < noFence.length; i++) {
      if (noFence[i] === '{') depth++;
      else if (noFence[i] === '}') {
        depth--;
        if (depth === 0) { jsonEnd = i + 1; break; }
      }
    }
    if (jsonEnd === -1) return fallback;
    const jsonStr = noFence.slice(jsonStart, jsonEnd);

    const parsed = JSON.parse(jsonStr) as ExtractedPlan;

    if (!Array.isArray(parsed.constraints)) parsed.constraints = [];
    if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      parsed.steps = [{ description: '执行用户请求', dependsOn: [] }];
    }
    if (!Array.isArray(parsed.artifacts)) parsed.artifacts = [];

    return parsed;
  } catch (err) {
    console.error('[TaskContract] extractContractFromMessage failed:', err instanceof Error ? err.message : String(err));
    return fallback;
  }
}

// ─── Contract 创建 ───

let contractSeq = 0;

export function createContract(
  extracted: ExtractedPlan,
  ecoConstraints: Constraint[],
): TaskContract {
  contractSeq++;
  const id = `tc-${Date.now()}-${contractSeq}`;

  return {
    id,
    createdAt: new Date().toISOString(),
    constraints: extracted.constraints.map((c, i) => ({
      id: `uc-${i}`,
      source: 'user' as const,
      text: c.text,
      category: c.category,
      verifiable: c.verifiable,
      verifyHint: c.verifyHint,
    })),
    ecoConstraints,
    steps: extracted.steps.map((s, i) => ({
      index: i,
      description: s.description,
      status: i === 0 ? 'in_progress' as const : 'pending' as const,
      dependsOn: s.dependsOn,
    })),
    currentStepIndex: 0,
    artifacts: extracted.artifacts,
    completed: false,
  };
}

// ─── System Prompt 注入 ───

/**
 * 构建注入到 system prompt 的 contract 文本。
 * 这段文本在每轮都注入，永远不会被上下文压缩吞噬。
 */
export function buildContractInjection(contract: TaskContract): string {
  if (isSimpleContract(contract)) return '';

  const parts: string[] = ['[TASK CONTRACT — 以下约束在整个任务期间持续有效，不可忽略]'];

  // 用户硬约束
  if (contract.constraints.length > 0) {
    parts.push('## 硬约束（用户要求）');
    for (const c of contract.constraints) {
      parts.push(`- [${c.category}] ${c.text}`);
    }
  }

  // 生态约束
  if (contract.ecoConstraints.length > 0) {
    parts.push('## 生态约束（系统规范）');
    for (const c of contract.ecoConstraints) {
      parts.push(`- [${c.category}] ${c.text}`);
    }
  }

  // 执行计划（参考清单，非状态机）。
  // 注意：这里刻意不标 DONE/CURRENT —— 早期版本用文本启发式逐步标"已完成"，
  // 会误导模型以为任务做完而提前空转。现由 ReAct 循环自行推进，计划仅作参考。
  if (contract.steps.length > 0) {
    parts.push('## 执行计划（参考，按需推进）');
    for (const step of contract.steps) {
      parts.push(`- ${step.index + 1}. ${step.description}`);
    }
    parts.push('要求：需要数据/检索/外部能力时，**实际调用相应工具**完成，不要假装已完成或跳过；所有步骤真正做完后，再输出最终的完整结果（不要只输出空话或计划）。');
  }

  // 预期产出
  if (contract.artifacts.length > 0) {
    parts.push('## 预期产出');
    for (const a of contract.artifacts) {
      parts.push(`- ${a}`);
    }
  }

  parts.push('[/TASK CONTRACT]');
  return parts.join('\n');
}

// ─── 步骤验收 ───

/**
 * 生成验收检查消息，注入到下一轮 messages 中。
 * 返回 null 表示当前不需要验收。
 */
export function buildCheckpointMessage(contract: TaskContract): string | null {
  if (isSimpleContract(contract) || contract.completed) return null;

  const currentStep = contract.steps[contract.currentStepIndex];
  if (!currentStep || currentStep.status !== 'in_progress') return null;

  const allConstraints = [...contract.constraints, ...contract.ecoConstraints];
  if (allConstraints.length === 0) return null;

  const lines = [
    `[CONTRACT CHECKPOINT] 步骤 ${currentStep.index}: "${contract.steps[currentStep.index - 1]?.description ?? ''}" 已完成。`,
    `现在执行步骤 ${currentStep.index + 1}: "${currentStep.description}"`,
    '注意：以下约束仍然有效，在执行过程中严格遵守：',
  ];
  for (const c of allConstraints) {
    lines.push(`- ${c.text}`);
  }
  lines.push('直接执行任务并输出结果，不要输出约束检查表。');

  return lines.join('\n');
}

/**
 * 推进步骤：将当前步骤标记为完成并启动下一步。
 * 返回 true = 还有后续步骤, false = 所有步骤已完成
 */
export function advanceStep(contract: TaskContract, stepOutput?: string): boolean {
  const current = contract.steps[contract.currentStepIndex];
  if (!current) return false;

  current.status = 'done';
  current.output = stepOutput;

  const nextIndex = contract.currentStepIndex + 1;
  if (nextIndex >= contract.steps.length) {
    contract.completed = true;
    return false;
  }

  contract.currentStepIndex = nextIndex;
  contract.steps[nextIndex]!.status = 'in_progress';
  return true;
}

/**
 * 标记当前步骤为失败。
 */
export function failStep(contract: TaskContract, reason?: string): void {
  const current = contract.steps[contract.currentStepIndex];
  if (current) {
    current.status = 'failed';
    current.output = reason;
  }
}

// ─── 工具函数 ───

/** 判断是否为简单任务（0 约束 + 1 步骤）— 跳过 contract 机制 */
export function isSimpleContract(contract: TaskContract): boolean {
  return contract.constraints.length === 0
    && contract.ecoConstraints.length === 0
    && contract.steps.length <= 1;
}

/** 序列化 contract 为 JSON（用于持久化） */
export function serializeContract(contract: TaskContract): string {
  return JSON.stringify(contract);
}

/** 反序列化 contract */
export function deserializeContract(json: string): TaskContract | null {
  try {
    return JSON.parse(json) as TaskContract;
  } catch {
    return null;
  }
}
