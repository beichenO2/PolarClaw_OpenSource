/**
 * Skill Composer — 技能组合引擎
 *
 * 将多个已注册工具串联/并联成工作流，作为新的复合工具暴露给 Agent。
 * 支持：
 * - 串行执行（前一步输出作为后一步输入）
 * - 并行执行（多个独立步骤同时执行）
 * - 条件分支（根据中间结果选择后续步骤）
 * - 数据映射（步骤间参数映射表达式）
 *
 * 工作流定义格式见 IWorkflowDef 接口。
 */

import type { IToolExecutor, IToolHandler } from '../../ports/tools.js';

/** 工作流步骤 */
export interface IWorkflowStep {
  /** 步骤 ID（用于引用输出） */
  id: string;
  /** 要调用的工具名 */
  tool: string;
  /** 参数映射：key = 工具参数名, value = 字面量 | "$input.xxx" | "$steps.stepId.xxx" */
  args: Record<string, string | number | boolean>;
  /** 依赖的步骤 ID 列表（为空则可并行，有值则等这些步骤完成后再执行） */
  dependsOn?: string[];
  /** 条件：仅当此表达式为真时执行（引用 $steps.xxx） */
  condition?: string;
}

/** 工作流定义 */
export interface IWorkflowDef {
  /** 工作流名称 */
  name: string;
  /** 工具名（注册到 Agent） */
  toolName: string;
  /** 描述 */
  description: string;
  /** 输入参数 schema */
  inputSchema: Record<string, unknown>;
  /** 步骤列表 */
  steps: IWorkflowStep[];
}

export function createSkillComposer(toolExecutor: IToolExecutor) {

  function resolveValue(
    template: string | number | boolean,
    input: Record<string, unknown>,
    stepResults: Map<string, unknown>,
  ): unknown {
    if (typeof template !== 'string') return template;

    if (template.startsWith('$input.')) {
      return getNestedValue(input, template.slice(7));
    }

    if (template.startsWith('$steps.')) {
      const rest = template.slice(7);
      const dotIdx = rest.indexOf('.');
      if (dotIdx === -1) return stepResults.get(rest);
      const stepId = rest.slice(0, dotIdx);
      const path = rest.slice(dotIdx + 1);
      const stepResult = stepResults.get(stepId);
      return getNestedValue(stepResult as Record<string, unknown> ?? {}, path);
    }

    return template;
  }

  function evaluateCondition(
    condition: string,
    stepResults: Map<string, unknown>,
  ): boolean {
    // "$steps.check.exists == true"
    const parts = condition.split(/\s*(==|!=|>|<)\s*/);
    if (parts.length !== 3) return true;

    const [left, op, right] = parts as [string, string, string];
    const leftVal = left.startsWith('$steps.')
      ? getNestedValue(
          stepResults.get(left.slice(7, left.indexOf('.', 7))) as Record<string, unknown> ?? {},
          left.slice(left.indexOf('.', 7) + 1),
        )
      : left;

    const rightVal = right === 'true' ? true
      : right === 'false' ? false
      : right === 'null' ? null
      : !isNaN(Number(right)) ? Number(right)
      : right.replace(/^['"]|['"]$/g, '');

    switch (op) {
      case '==': return leftVal == rightVal;
      case '!=': return leftVal != rightVal;
      case '>': return Number(leftVal) > Number(rightVal);
      case '<': return Number(leftVal) < Number(rightVal);
      default: return true;
    }
  }

  return {
    /**
     * 从工作流定义创建复合工具并注册到 Agent。
     * 返回注册的工具名。
     */
    compose(workflow: IWorkflowDef): string {
      const handler: IToolHandler = {
        name: workflow.toolName,
        description: workflow.description,
        parameters: workflow.inputSchema,

        async handler(input: Record<string, unknown>) {
          const stepResults = new Map<string, unknown>();
          const completed = new Set<string>();

          const stepsById = new Map(workflow.steps.map(s => [s.id, s]));

          async function executeStep(step: IWorkflowStep): Promise<void> {
            if (completed.has(step.id)) return;

            // wait for dependencies
            for (const dep of step.dependsOn ?? []) {
              if (!completed.has(dep)) {
                const depStep = stepsById.get(dep);
                if (depStep) await executeStep(depStep);
              }
            }

            // check condition
            if (step.condition && !evaluateCondition(step.condition, stepResults)) {
              stepResults.set(step.id, { skipped: true, reason: 'condition not met' });
              completed.add(step.id);
              return;
            }

            const resolvedArgs: Record<string, unknown> = {};
            for (const [key, val] of Object.entries(step.args)) {
              resolvedArgs[key] = resolveValue(val, input, stepResults);
            }

            try {
              const result = await toolExecutor.execute(step.tool, resolvedArgs);
              stepResults.set(step.id, result);
            } catch (err) {
              stepResults.set(step.id, {
                error: err instanceof Error ? err.message : String(err),
              });
            }
            completed.add(step.id);
          }

          // find independent steps (no dependencies) and run them in parallel waves
          const independent = workflow.steps.filter(s => !s.dependsOn?.length);
          const dependent = workflow.steps.filter(s => s.dependsOn?.length);

          await Promise.all(independent.map(s => executeStep(s)));
          for (const step of dependent) {
            await executeStep(step);
          }

          const result: Record<string, unknown> = {};
          for (const [id, val] of stepResults) {
            result[id] = val;
          }
          return result;
        },
      };

      toolExecutor.register(handler);
      console.error(`[SkillComposer] 已注册工作流: ${workflow.toolName} (${workflow.steps.length} 步)`);
      return workflow.toolName;
    },

    /**
     * 解析 JSON 工作流定义文件。
     * 可从 skills/xxx/workflow.json 加载。
     */
    parseWorkflow(json: string): IWorkflowDef {
      return JSON.parse(json) as IWorkflowDef;
    },
  };
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
