/**
 * Hub Alignment Client — bridges PolarClaw YOLO engine to PolarCopilot Hub's
 * structured alignment and review workflow.
 *
 * Falls back to the original heuristic+LLM-as-Judge flow when Hub is unreachable.
 */

export interface IHubAlignmentConfig {
  hubBaseUrl: string;
  agentId: string;
  /** Connection timeout ms (default 5000) */
  timeoutMs?: number;
}

export interface AlignmentDoc {
  id: string;
  status: 'draft' | 'reviewing' | 'executing' | 'completed' | 'rejected';
  version: number;
  sections?: Array<{ name: string; confirmed: boolean }>;
}

export interface IHubAlignmentClient {
  /** Create alignment document for YOLO goal. Returns null if Hub unreachable. */
  createAlignment(goal: string, plan: string, sections: string[]): Promise<AlignmentDoc | null>;
  /** Poll alignment status until approved, rejected, or timeout. */
  waitForApproval(alignmentId: string, timeoutMs?: number): Promise<'approved' | 'rejected' | 'timeout'>;
  /** Report step progress via info prompt. */
  reportProgress(step: number, message: string): Promise<void>;
  /** Mark alignment as completed. */
  completeAlignment(alignmentId: string): Promise<void>;
  /** Check if Hub is reachable. */
  isAvailable(): Promise<boolean>;
}

async function hubFetch<T>(
  baseUrl: string,
  path: string,
  opts: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T | null> {
  const { method = 'GET', body, timeoutMs = 5000 } = opts;
  try {
    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(`${baseUrl}${path}`, init);
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

export function createHubAlignmentClient(config: IHubAlignmentConfig): IHubAlignmentClient {
  const { hubBaseUrl, agentId, timeoutMs = 5000 } = config;

  return {
    async isAvailable() {
      const result = await hubFetch(hubBaseUrl, '/api/health', { timeoutMs: 3000 });
      return result !== null;
    },

    async createAlignment(goal, plan, sectionNames) {
      const sections = sectionNames.map(name => ({ name, confirmed: false }));
      const result = await hubFetch<{ id: string; status: string; version: number }>(
        hubBaseUrl,
        '/api/ui/alignment',
        {
          method: 'POST',
          body: {
            agent_id: agentId,
            goal,
            work_logic: 'Debug > Test > Dev',
            plan_markdown: plan,
            sections,
          },
          timeoutMs,
        },
      );
      if (!result?.id) return null;
      return {
        id: result.id,
        status: 'draft' as const,
        version: result.version ?? 1,
        sections,
      };
    },

    async waitForApproval(alignmentId, maxWaitMs = 300_000) {
      const startTime = Date.now();
      const pollInterval = 5000;

      while (Date.now() - startTime < maxWaitMs) {
        const doc = await hubFetch<{ status: string }>(
          hubBaseUrl,
          `/api/ui/alignment/${alignmentId}`,
          { timeoutMs },
        );

        if (!doc) {
          await new Promise(r => setTimeout(r, pollInterval));
          continue;
        }

        if (doc.status === 'executing') return 'approved';
        if (doc.status === 'rejected' || doc.status === 'completed') return 'rejected';

        await new Promise(r => setTimeout(r, pollInterval));
      }

      return 'timeout';
    },

    async reportProgress(step, message) {
      await hubFetch(hubBaseUrl, '/api/ui/prompts', {
        method: 'POST',
        body: {
          agent_id: agentId,
          prompt: `[YOLO 步骤 ${step}] ${message}`,
        },
        timeoutMs,
      });
    },

    async completeAlignment(alignmentId) {
      await hubFetch(hubBaseUrl, `/api/ui/alignment/${alignmentId}/complete`, {
        method: 'POST',
        body: {},
        timeoutMs,
      });
    },
  };
}
