#!/usr/bin/env node
/**
 * test-conv-isolation — 验证多 conversation_id 并行 SSE 互不阻塞。
 *
 * 用法：node scripts/test-conv-isolation.mjs [baseUrl]
 * 默认 baseUrl=http://127.0.0.1:3910
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3910';

async function streamChat(conversationId, message, label) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/api/agent/chat/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message,
      conversation_id: conversationId,
      settings: { maxRounds: 1 },
    }),
  });
  if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
  const reader = res.body?.getReader();
  if (!reader) throw new Error(`${label} no body`);
  const dec = new TextDecoder();
  let buf = '';
  let content = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    for (const line of buf.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      try {
        const evt = JSON.parse(line.slice(6));
        if (evt.type === 'done') content = evt.content ?? '';
      } catch { /* skip */ }
    }
    buf = buf.split('\n').pop() ?? '';
  }
  return { label, conversationId, ms: Date.now() - t0, contentLen: content.length };
}

async function main() {
  const convA = `iso_a_${Date.now()}`;
  const convB = `iso_b_${Date.now()}`;

  console.log('=== 多会话并行隔离测试 ===');
  console.log(`API: ${BASE}`);
  console.log(`convA=${convA} convB=${convB}`);

  const pA = streamChat(convA, '用三句话介绍反应器选型（稍详细）', 'A');
  await new Promise(r => setTimeout(r, 300));
  const pB = streamChat(convB, '只回复两个字母：OK', 'B');

  const [rA, rB] = await Promise.all([pA, pB]);

  console.log(`A: ${rA.ms}ms contentLen=${rA.contentLen}`);
  console.log(`B: ${rB.ms}ms contentLen=${rB.contentLen}`);

  const bFaster = rB.ms < rA.ms;
  const bHasReply = rB.contentLen > 0;

  console.log('---');
  if (bHasReply && bFaster) {
    console.log('PASS | B 短回复先于 A 长回复完成 → 会话并行不互阻塞');
    process.exit(0);
  }
  console.log('FAIL | B 应更快完成且有内容');
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
