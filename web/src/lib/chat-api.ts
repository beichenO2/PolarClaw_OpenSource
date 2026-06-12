export interface ChatDeployment {
  id: string
  workflow_id: string
  library: 'WF' | 'LG'
  display_name: string
  deployed_at: string
  memory?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** 思维链/推理细节（deepseek 风格折叠展示） */
  reasoning?: string
  annotations?: ChatAnnotation[]
}

/** Chat 面板可调设置（模型 / RetryLoop / 最大循环次数） */
export interface ChatAgentSettings {
  thinkingCapability?: string
  toolCapability?: string
  retryLoop?: boolean
  maxRounds?: number
}

export interface CapabilityOption {
  code: string
  label: string
  group: string
}

/** 可选能力码（与 PolarPrivate QCSA 映射对齐；空码=自动按意图路由） */
export const CAPABILITY_OPTIONS: CapabilityOption[] = [
  { code: '', label: '自动（按意图路由）', group: '通用' },
  { code: '1110', label: 'MiniMax-M3-Thinking · 深度推理', group: '推理' },
  { code: '0100', label: 'DeepSeek V4 Pro · 长上下文 1M', group: '推理' },
  { code: '1000', label: 'GLM-5.1 · 旗舰', group: '推理' },
  { code: '0001', label: 'DeepSeek V4 Flash · Agent 均衡(工具最准)', group: 'Agent' },
  { code: '0101', label: 'DeepSeek V4 Pro · Agent 长上下文', group: 'Agent' },
  { code: '1001', label: 'DeepSeek V4 Pro · Agent 旗舰(多步)', group: 'Agent' },
  { code: '0000', label: 'GLM-5.1 · 均衡对话', group: '文本' },
  { code: '0010', label: 'DeepSeek V4 Flash · 快速', group: '文本' },
  { code: '0110', label: 'MiniMax-M3 · 快速长文', group: '文本' },
  { code: '1100', label: 'Qwen3.7-Plus · 旗舰长文', group: '文本' },
]

export interface ChatAnnotation {
  id: string
  quotedText: string
  note: string
}

export interface ConversationMeta {
  id: string
  title: string
  workflowId: string
  updatedAt: string
}

const STORAGE_CONVERSATIONS = 'polarui_chat_conversations'
const STORAGE_MESSAGES_PREFIX = 'polarui_chat_messages_'

export async function fetchDeployments(): Promise<ChatDeployment[]> {
  const res = await fetch('/api/deployments')
  if (!res.ok) return []
  return res.json()
}

export async function sendWorkflowChat(opts: {
  workflow_id: string
  conversation_id: string
  message: string
  user_id?: string
}): Promise<{ content: string | null; error?: string }> {
  const res = await fetch('/api/workflow/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(opts),
  })
  const data = await res.json() as { content?: string | null; error?: string }
  if (!res.ok) {
    return { content: null, error: data.error ?? `HTTP ${res.status}` }
  }
  return { content: data.content ?? null }
}

export function loadConversations(): ConversationMeta[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_CONVERSATIONS) ?? '[]') as ConversationMeta[]
  } catch {
    return []
  }
}

export function saveConversations(list: ConversationMeta[]) {
  localStorage.setItem(STORAGE_CONVERSATIONS, JSON.stringify(list))
}

export function loadMessages(conversationId: string): ChatMessage[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_MESSAGES_PREFIX + conversationId) ?? '[]') as ChatMessage[]
  } catch {
    return []
  }
}

export function saveMessages(conversationId: string, messages: ChatMessage[]) {
  localStorage.setItem(STORAGE_MESSAGES_PREFIX + conversationId, JSON.stringify(messages))
}

export const POLARCLAW_DIRECT_ID = '__polarclaw__'

export function isDirectAgent(workflowId: string): boolean {
  return workflowId === POLARCLAW_DIRECT_ID
}

export interface AgentStreamEvent {
  type: 'thinking' | 'reasoning' | 'content' | 'tool_call' | 'tool_result' | 'done' | 'error'
  round?: number
  model?: string
  /** reasoning/content 增量片段 */
  delta?: string
  tool?: string
  args?: Record<string, unknown>
  result?: string
  success?: boolean
  duration_ms?: number
  content?: string
  message?: string
}

export async function sendAgentChat(opts: {
  conversation_id: string
  message: string
  settings?: ChatAgentSettings
  signal?: AbortSignal
  onEvent?: (event: AgentStreamEvent) => void
}): Promise<{ content: string | null; error?: string }> {
  try {
    const res = await fetch('/api/agent/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: opts.message,
        conversation_id: opts.conversation_id,
        settings: opts.settings,
      }),
      signal: opts.signal,
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({})) as { error?: string }
      return { content: null, error: data.error ?? `HTTP ${res.status}` }
    }

    const reader = res.body?.getReader()
    if (!reader) return { content: null, error: 'No response body' }

    const decoder = new TextDecoder()
    let buffer = ''
    let finalContent: string | null = null

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const payload = JSON.parse(line.slice(6)) as AgentStreamEvent
            opts.onEvent?.(payload)
            if (payload.type === 'done') {
              finalContent = payload.content ?? null
            } else if (payload.type === 'error') {
              return { content: null, error: payload.message ?? 'Agent error' }
            }
          } catch { /* skip malformed SSE */ }
        }
      }
    }

    return { content: finalContent }
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { content: null, error: 'aborted' }
    }
    return { content: null, error: String(err) }
  }
}

export interface ServerConversationMeta {
  id: string
  title: string
  messageCount: number
  updatedAt: string
}

export interface ServerChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string | null
}

export async function fetchServerConversations(): Promise<ServerConversationMeta[]> {
  try {
    const res = await fetch('/api/conversations?limit=40')
    if (!res.ok) return []
    return await res.json() as ServerConversationMeta[]
  } catch {
    return []
  }
}

export async function fetchServerMessages(conversationId: string): Promise<ChatMessage[]> {
  try {
    const res = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}?limit=200`)
    if (!res.ok) return []
    const data = await res.json() as { messages?: ServerChatMessage[] }
    return (data.messages ?? []).map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
    }))
  } catch {
    return []
  }
}

export function mergeChatMessages(local: ChatMessage[], server: ChatMessage[]): ChatMessage[] {
  if (server.length === 0) return local
  if (local.length === 0) return server
  const serverSigs = new Set(server.map(m => `${m.role}:${m.content.slice(0, 120)}`))
  const localOnly = local.filter(m => !serverSigs.has(`${m.role}:${m.content.slice(0, 120)}`))
  return [...server, ...localOnly.filter(m => m.id !== '__streaming__')]
}

export function mergeConversationLists(
  local: ConversationMeta[],
  server: ServerConversationMeta[],
): ConversationMeta[] {
  const byId = new Map<string, ConversationMeta>()
  for (const c of local) byId.set(c.id, c)
  for (const s of server) {
    const existing = byId.get(s.id)
    byId.set(s.id, {
      id: s.id,
      title: existing?.title && existing.title !== '新对话' ? existing.title : s.title,
      workflowId: existing?.workflowId ?? POLARCLAW_DIRECT_ID,
      updatedAt: s.updatedAt || existing?.updatedAt || new Date().toISOString(),
    })
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 40)
}

export function newConversationId(): string {
  return `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
