#!/usr/bin/env node
/**
 * 260525 Phase 1 — SessionMemory HTTP 探针（自启临时 Express，不依赖 PolarClaw 主进程）
 */
import express from 'express'
import { createServer } from 'node:http'
import { SessionMemoryManager } from '../src/memory/SessionMemory.ts'

let failed = 0
const ok = (m) => console.log('OK:', m)
const fail = (m) => { console.error('FAIL:', m); failed++ }

const sm = new SessionMemoryManager({ polarMemoryBaseUrl: 'http://127.0.0.1:3100' })
const app = express()
app.use(express.json())

app.get('/api/session-memory/:convId', (req, res) => {
  const convId = req.params.convId
  const session = sm.getOrCreateSession(convId)
  res.json({
    conversation_id: convId,
    context: sm.buildMemoryInjection(convId),
    working_count: session.working.length,
    episodic_count: session.episodic.length,
    long_term_count: session.longTermBlocks.length,
    core_facts: session.coreFacts || '',
  })
})

app.post('/api/session-memory/:convId/messages', (req, res) => {
  const convId = req.params.convId
  const body = req.body
  const session = sm.getOrCreateSession(convId)
  const incoming = body.messages
    ? body.messages.map(m => ({ role: m.role, content: String(m.content ?? '') }))
    : body.message
    ? [{ role: body.role ?? 'user', content: String(body.message) }]
    : []
  const next = body.replace ? incoming : [...session.working, ...incoming]
  sm.updateWorkingMemory(convId, next)
  res.json({ conversation_id: convId, working_count: next.length })
})

app.post('/api/session-memory/:convId/compress', async (req, res) => {
  const convId = req.params.convId
  const compressed = await sm.compressForNextTurn(convId)
  const session = sm.getOrCreateSession(convId)
  res.json({
    conversation_id: convId,
    compressed_chars: compressed.length,
    episodic_count: session.episodic.length,
    working_count: session.working.length,
  })
})

app.delete('/api/session-memory/:convId', (req, res) => {
  sm.clearSession(req.params.convId)
  res.json({ ok: true })
})

const server = createServer(app)
await new Promise((resolve, reject) => {
  server.listen(0, '127.0.0.1', () => resolve(undefined))
  server.on('error', reject)
})
const port = server.address().port
const base = `http://127.0.0.1:${port}`
ok(`temp server on :${port}`)

const convId = 'probe-conv-1'

let r = await fetch(`${base}/api/session-memory/${convId}`)
if (!r.ok) fail(`GET ${r.status}`)
else ok('GET session-memory')

r = await fetch(`${base}/api/session-memory/${convId}/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '我叫小明', role: 'user' }),
})
if (!r.ok) fail(`POST messages ${r.status}`)
else ok('POST messages')

r = await fetch(`${base}/api/session-memory/${convId}/messages`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: '你好', role: 'assistant' }),
})
if (!r.ok) fail(`POST assistant ${r.status}`)
else ok('POST assistant message')

r = await fetch(`${base}/api/session-memory/${convId}`)
const inj = await r.json()
if (inj.working_count !== 2) fail(`working_count expected 2, got ${inj.working_count}`)
else ok(`working_count=${inj.working_count}`)

r = await fetch(`${base}/api/session-memory/${convId}/compress`, { method: 'POST' })
if (!r.ok) fail(`POST compress ${r.status}`)
else ok('POST compress')

r = await fetch(`${base}/api/session-memory/${convId}`)
const after = await r.json()
if (after.episodic_count < 1) fail('episodic_count should be >= 1 after compress')
else ok(`episodic_count=${after.episodic_count}`)

r = await fetch(`${base}/api/session-memory/${convId}`, { method: 'DELETE' })
if (!r.ok) fail(`DELETE ${r.status}`)
else ok('DELETE session')

server.close()
console.log(`\n--- session-memory-probe: ${failed} failures ---`)
process.exit(failed ? 1 : 0)
