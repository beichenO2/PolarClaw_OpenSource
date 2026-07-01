#!/usr/bin/env node
/**
 * PolarPrivate：feishu.girlfriend.* → feishu.rr.*，删除 feishu.polarclaw_rr.*
 */
const PP = process.env.POLARPRIVATE_URL ?? 'http://127.0.0.1:12790';

const RENAME = [
  ['feishu.girlfriend.app_id', 'feishu.rr.app_id'],
  ['feishu.girlfriend.app_secret', 'feishu.rr.app_secret'],
  ['feishu.girlfriend.verification_token', 'feishu.rr.verification_token'],
  ['feishu.girlfriend.encrypt_key', 'feishu.rr.encrypt_key'],
];

const DELETE_KEYS = [
  'feishu.polarclaw_rr.app_id',
  'feishu.polarclaw_rr.app_secret',
  'feishu.polarclaw_rr.verification_token',
  'feishu.polarclaw_rr.encrypt_key',
];

async function listSecrets() {
  const res = await fetch(`${PP}/api/secrets?limit=200`);
  if (!res.ok) throw new Error(`list secrets: ${res.status}`);
  return (await res.json()).items ?? [];
}

async function patchKey(id, key) {
  const res = await fetch(`${PP}/api/secrets/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!res.ok) throw new Error(`patch ${key}: ${res.status}`);
}

async function deleteSecret(id, key) {
  const res = await fetch(`${PP}/api/secrets/${id}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`delete ${key}: ${res.status}`);
}

async function main() {
  const items = await listSecrets();
  const byKey = Object.fromEntries(items.map((i) => [i.key, i]));

  const renamed = [];
  for (const [from, to] of RENAME) {
    const row = byKey[from];
    if (!row) continue;
    if (byKey[to]) {
      console.error(`skip rename ${from} → ${to}（${to} 已存在）`);
      await deleteSecret(row.id, from);
      continue;
    }
    await patchKey(row.id, to);
    renamed.push(`${from} → ${to}`);
  }

  const deleted = [];
  for (const key of DELETE_KEYS) {
    const row = byKey[key];
    if (!row) continue;
    await deleteSecret(row.id, key);
    deleted.push(key);
  }

  console.log(JSON.stringify({ ok: true, renamed, deleted }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }));
  process.exit(1);
});
