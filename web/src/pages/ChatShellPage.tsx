import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import clsx from 'clsx'
import { MessageList } from '../components/chat/MessageList'
import { ChatComposer } from '../components/chat/ChatComposer'
import { WorkflowPicker } from '../components/chat/WorkflowPicker'
import { ChatSettingsPanel } from '../components/chat/ChatSettingsPanel'
import {
  type AgentStreamEvent,
  type ChatAgentSettings,
  type ChatAnnotation,
  type ChatDeployment,
  type ChatMessage,
  type ConversationMeta,
  fetchDeployments,
  fetchServerConversations,
  fetchServerMessages,
  isDirectAgent,
  loadConversations,
  loadMessages,
  mergeChatMessages,
  mergeConversationLists,
  newConversationId,
  POLARCLAW_DIRECT_ID,
  saveConversations,
  saveMessages,
  sendAgentChat,
  sendWorkflowChat,
} from '../lib/chat-api'

const SETTINGS_STORAGE_KEY = 'polarui_chat_agent_settings'
const DEFAULT_SETTINGS: ChatAgentSettings = {
  thinkingCapability: '',
  toolCapability: '',
  retryLoop: true,
  maxRounds: 15,
}

function loadSettings(): ChatAgentSettings {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function buildUserPayload(text: string, annotations: ChatAnnotation[]): string {
  if (annotations.length === 0) return text
  const annParts = annotations.map(
    (a, i) => `【批注 ${i + 1}】"${a.quotedText}"\n→ ${a.note}`,
  )
  return [text, ...annParts].filter(Boolean).join('\n\n')
}

export function ChatShellPage() {
  const navigate = useNavigate()
  const { conversationId: routeConvId } = useParams()
  const [searchParams] = useSearchParams()

  const [deployments, setDeployments] = useState<ChatDeployment[]>([])
  const [workflowId, setWorkflowId] = useState(searchParams.get('workflow') ?? '')
  const [conversations, setConversations] = useState<ConversationMeta[]>(() => loadConversations())
  const [conversationId, setConversationId] = useState(routeConvId ?? newConversationId())
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadMessages(conversationId))
  const [input, setInput] = useState('')
  const [pendingAnnotations, setPendingAnnotations] = useState<ChatAnnotation[]>([])
  const [sending, setSending] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settings, setSettings] = useState<ChatAgentSettings>(() => loadSettings())

  const activeConvRef = useRef(conversationId)
  const abortRef = useRef<AbortController | null>(null)
  const pendingByConvRef = useRef<Record<string, boolean>>({})

  useEffect(() => {
    activeConvRef.current = conversationId
  }, [conversationId])

  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    fetchDeployments().then(list => {
      setDeployments(list)
      if (!workflowId) setWorkflowId(POLARCLAW_DIRECT_ID)
    })
  }, [])

  useEffect(() => {
    fetchServerConversations().then(serverList => {
      if (serverList.length === 0) return
      setConversations(prev => mergeConversationLists(prev, serverList))
    })
    void loadConversationView(conversationId)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap
  }, [])

  useEffect(() => {
    if (routeConvId && routeConvId !== conversationId) {
      abortInflight()
      setSending(!!pendingByConvRef.current[routeConvId])
      setConversationId(routeConvId)
      void loadConversationView(routeConvId)
    }
  }, [routeConvId])

  async function loadConversationView(id: string) {
    const local = loadMessages(id)
    const server = await fetchServerMessages(id)
    setMessages(mergeChatMessages(local, server))
  }

  function abortInflight() {
    abortRef.current?.abort()
    abortRef.current = null
  }

  useEffect(() => {
    saveMessages(conversationId, messages)
  }, [conversationId, messages])

  function persistConversationMeta(title: string) {
    const meta: ConversationMeta = {
      id: conversationId,
      title: title.slice(0, 48) || '新对话',
      workflowId,
      updatedAt: new Date().toISOString(),
    }
    const next = [meta, ...conversations.filter(c => c.id !== conversationId)].slice(0, 40)
    setConversations(next)
    saveConversations(next)
  }

  function startNewChat(nextWorkflowId?: string) {
    abortInflight()
    const wf = nextWorkflowId ?? workflowId
    const id = newConversationId()
    setConversationId(id)
    activeConvRef.current = id
    setMessages([])
    setPendingAnnotations([])
    setInput('')
    setSending(false)
    if (nextWorkflowId) setWorkflowId(nextWorkflowId)
    navigate(`/chat/${id}${wf ? `?workflow=${encodeURIComponent(wf)}` : ''}`)
  }

  function switchConversation(id: string) {
    abortInflight()
    setConversationId(id)
    activeConvRef.current = id
    setPendingAnnotations([])
    setSending(!!pendingByConvRef.current[id])
    void loadConversationView(id)
    const conv = conversations.find(c => c.id === id)
    if (conv?.workflowId) setWorkflowId(conv.workflowId)
    navigate(`/chat/${id}`)
  }

  async function handleSend() {
    const text = input.trim()
    if (!text || !workflowId || pendingByConvRef.current[conversationId]) return

    const userMsg: ChatMessage = {
      id: `m_${Date.now()}`,
      role: 'user',
      content: buildUserPayload(text, pendingAnnotations),
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setPendingAnnotations([])
    persistConversationMeta(text)
    const convAtStart = conversationId
    pendingByConvRef.current[convAtStart] = true
    if (activeConvRef.current === convAtStart) setSending(true)

    const ac = new AbortController()
    abortRef.current = ac

    let content: string | null = null
    let error: string | undefined
    let reasoning = ''

    if (isDirectAgent(workflowId)) {
      const steps: string[] = []
      let answer = ''
      const renderStreaming = () => {
        if (activeConvRef.current !== convAtStart) return
        const body = [steps.join('\n'), answer].filter(Boolean).join(steps.length && answer ? '\n\n' : '')
        setMessages(prev => {
          const streamMsg: ChatMessage = { id: '__streaming__', role: 'assistant', content: body, reasoning }
          const last = prev[prev.length - 1]
          if (last?.id === '__streaming__') return [...prev.slice(0, -1), streamMsg]
          return [...prev, streamMsg]
        })
      }
      const result = await sendAgentChat({
        conversation_id: convAtStart,
        message: userMsg.content,
        settings,
        signal: ac.signal,
        onEvent: (evt: AgentStreamEvent) => {
          if (activeConvRef.current !== convAtStart) return
          if (evt.type === 'reasoning') {
            if (evt.delta) reasoning += evt.delta
          } else if (evt.type === 'content') {
            if (evt.delta) answer += evt.delta
          } else if (evt.type === 'tool_call') {
            const argStr = evt.args ? Object.entries(evt.args).map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 40) : JSON.stringify(v).slice(0, 40)}`).join(', ') : ''
            steps.push(`🔧 \`${evt.tool}\`(${argStr})`)
          } else if (evt.type === 'tool_result') {
            const icon = evt.success !== false ? '✅' : '❌'
            const dur = evt.duration_ms ? ` ${evt.duration_ms}ms` : ''
            steps.push(`${icon} → ${(evt.result ?? '').slice(0, 120)}${dur}`)
          } else {
            return
          }
          renderStreaming()
        },
      })
      content = result.content
      error = result.error === 'aborted' ? undefined : result.error
    } else {
      const result = await sendWorkflowChat({
        workflow_id: workflowId,
        conversation_id: convAtStart,
        message: userMsg.content,
      })
      content = result.content
      error = result.error
    }

    pendingByConvRef.current[convAtStart] = false
    if (abortRef.current === ac) abortRef.current = null

    if (activeConvRef.current === convAtStart) {
      if (!ac.signal.aborted && error !== 'aborted') {
        setMessages(prev => {
          const filtered = prev.filter(m => m.id !== '__streaming__')
          return [...filtered, {
            id: `m_${Date.now()}_a`,
            role: 'assistant' as const,
            content: error ? `错误：${error}` : (content ?? '（无回复）'),
            reasoning: reasoning.trim() ? reasoning : undefined,
          }]
        })
      } else if (ac.signal.aborted) {
        setMessages(prev => prev.filter(m => m.id !== '__streaming__'))
      }
      setSending(false)
    }
  }

  function handleAnnotate(_messageId: string, annotation: ChatAnnotation) {
    setPendingAnnotations(prev => [...prev, annotation])
  }

  const selectedDeployment = deployments.find(d => d.id === workflowId)

  return (
    <div className="h-screen flex bg-[#212121] text-[#ececec] overflow-hidden">
      {/* Sidebar — ChatGPT 左栏 */}
      <aside
        className={clsx(
          'flex flex-col border-r border-[#444654] bg-[#171717] transition-all duration-200',
          sidebarOpen ? 'w-64' : 'w-0 overflow-hidden',
        )}
      >
        <div className="p-3">
          <button
            type="button"
            onClick={() => startNewChat()}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-[#565869] hover:bg-[#2f2f2f] text-sm"
          >
            + 新对话
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 space-y-0.5">
          {conversations.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => switchConversation(c.id)}
              className={clsx(
                'w-full text-left px-3 py-2 rounded-lg text-sm truncate',
                c.id === conversationId ? 'bg-[#2f2f2f]' : 'hover:bg-[#2f2f2f]/60 text-[#c9d1d9]',
              )}
            >
              {c.title}
            </button>
          ))}
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header — workflow 下拉替代 model 下拉 */}
        <header className="h-12 flex items-center gap-3 px-4 border-b border-[#444654] shrink-0">
          <button
            type="button"
            className="text-[#8e8ea0] hover:text-white text-lg"
            onClick={() => setSidebarOpen(v => !v)}
            aria-label="切换侧栏"
          >
            ☰
          </button>
          <WorkflowPicker
            deployments={deployments}
            value={workflowId}
            onChange={id => startNewChat(id)}
          />
          {selectedDeployment && (
            <span className="text-xs text-[#8e8ea0] hidden sm:inline">
              {selectedDeployment.id === POLARCLAW_DIRECT_ID
                ? 'Agent 直连 · ReAct 多轮 + 工具调用'
                : `${selectedDeployment.library} · 模型在工作流内配置`}
            </span>
          )}
          <div className="ml-auto">
            {isDirectAgent(workflowId) && (
              <ChatSettingsPanel value={settings} onChange={setSettings} />
            )}
          </div>
        </header>

        <MessageList
          messages={messages}
          pending={sending}
          onAnnotate={handleAnnotate}
        />

        <ChatComposer
          value={input}
          onChange={setInput}
          onSend={handleSend}
          disabled={sending || !workflowId}
          pendingAnnotations={pendingAnnotations}
          onRemoveAnnotation={id => setPendingAnnotations(prev => prev.filter(a => a.id !== id))}
        />
      </div>
    </div>
  )
}
