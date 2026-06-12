// skills/ecosystem-orchestration/tools.ts
import { execFile, spawnSync } from "node:child_process";
import { resolve as resolve2 } from "node:path";
import { promisify } from "node:util";

// skills/_shared/port-discovery.js
import { createRequire } from "node:module";
import { resolve } from "node:path";
var _require = createRequire(import.meta.url);
var _sdk = null;
function getSDK() {
  if (_sdk)
    return _sdk;
  const home = process.env.HOME ?? "~";
  const candidates = [
    process.env.PORT_SDK_PATH,
    resolve(home, "Polarisor/SOTAgent/sdk-port/index.js")
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      _sdk = _require(p);
      return _sdk;
    } catch {
    }
  }
  return null;
}
var SOTAGENT_BASE = process.env.SOTAGENT_URL ?? "http://127.0.0.1:4800";
var _lastRecoveryAttempt = 0;
var RECOVERY_COOLDOWN_MS = 6e4;
async function ensureSOTAgentAlive() {
  try {
    const res = await fetch(`${SOTAGENT_BASE}/api/status`, { signal: AbortSignal.timeout(3e3) });
    return res.ok;
  } catch {
    if (Date.now() - _lastRecoveryAttempt < RECOVERY_COOLDOWN_MS)
      return false;
    _lastRecoveryAttempt = Date.now();
    console.warn("[port-discovery] SOTAgent unreachable, attempting sotctl start...");
    try {
      const { execSync } = await import("node:child_process");
      execSync("sotctl start 2>/dev/null || ~/Polarisor/SOTAgent/bin/sotctl start", {
        timeout: 15e3,
        stdio: "ignore"
      });
      await new Promise((r) => setTimeout(r, 3e3));
      const res = await fetch(`${SOTAGENT_BASE}/api/status`, { signal: AbortSignal.timeout(3e3) });
      if (res.ok) {
        console.log("[port-discovery] SOTAgent recovered via sotctl start");
        return true;
      }
    } catch {
    }
    return false;
  }
}
var _portCache = /* @__PURE__ */ new Map();
var CACHE_TTL_MS = 6e4;
async function getServicePort(serviceName) {
  const cached = _portCache.get(serviceName);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS)
    return cached.port;
  const sdk = getSDK();
  if (!sdk) {
    await ensureSOTAgentAlive();
    return null;
  }
  const port = await sdk.getPort(serviceName);
  if (port != null) {
    _portCache.set(serviceName, { port, ts: Date.now() });
  } else {
    await ensureSOTAgentAlive();
  }
  return port;
}
function getGatewayUrl(servicePrefix) {
  return `${SOTAGENT_BASE}/gw/${servicePrefix.toLowerCase()}`;
}
async function getServiceUrl(serviceName, gatewayPrefix) {
  if (gatewayPrefix) {
    return getGatewayUrl(gatewayPrefix);
  }
  const port = await getServicePort(serviceName);
  if (port == null) {
    throw new Error(`[port-discovery] Cannot resolve port for "${serviceName}" \u2014 SOTAgent/port-sdk unavailable`);
  }
  return `http://127.0.0.1:${port}`;
}
var SERVICES = {
  DIGIST: { name: "digist-api", gateway: "digist" },
  KNOWLEVER_RAG: { name: "knowlever-rag", gateway: "knowlever" },
  AUTOOFFICE: { name: "autooffice", gateway: "autooffice" },
  CLOCK: { name: "clock-backend", gateway: "clock" },
  POLARPRIVATE: { name: "polarprivate-backend", gateway: "polarprivate" }
};

// skills/ecosystem-orchestration/tools.ts
var execFileAsync = promisify(execFile);
async function httpGet(url, timeoutMs = 8e3) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}
async function httpPost(url, data, timeoutMs = 3e4) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      signal: controller.signal
    });
    const body = await res.text();
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}
async function getDigistBase() {
  return getServiceUrl(SERVICES.DIGIST.name, SERVICES.DIGIST.gateway);
}
async function getKnowLeverRagBase() {
  return getServiceUrl(SERVICES.KNOWLEVER_RAG.name, SERVICES.KNOWLEVER_RAG.gateway);
}
function getKnowLeverDir() {
  const env = process.env.KNOWLEVER_DIR?.trim();
  if (env) return resolve2(env);
  const home = process.env.HOME ?? "~";
  return resolve2(home, "Polarisor/KnowLever");
}
function findPython() {
  const candidates = ["/opt/homebrew/bin/python3", "python3"];
  for (const c of candidates) {
    try {
      const r = spawnSync(c, ["--version"], { stdio: "pipe" });
      if (r.status === 0) return c;
    } catch {
    }
  }
  return "python3";
}
async function runPythonScript(script, payload, timeoutMs = 15e3) {
  const klDir = getKnowLeverDir();
  const python = findPython();
  const { stdout } = await execFileAsync(
    python,
    ["-c", script, klDir, JSON.stringify(payload)],
    { timeout: timeoutMs, cwd: klDir }
  );
  return stdout.trim();
}
var ecosystemStatus = {
  name: "ecosystem_status",
  description: "\u68C0\u67E5\u6574\u4E2A Polarisor \u751F\u6001\u7CFB\u7EDF\u7684\u5065\u5EB7\u72B6\u6001\u3002\u5305\u62EC digist\uFF08\u4FE1\u606F\u91C7\u96C6\uFF09\u3001KnowLever RAG\uFF08\u77E5\u8BC6\u68C0\u7D22\uFF09\u3001\u7AEF\u53E3\u6CE8\u518C\u72B6\u6001\u3002",
  parameters: { type: "object", properties: {} },
  async handler() {
    const results = {};
    try {
      const digistBase = await getDigistBase();
      const { body } = await httpGet(`${digistBase}/health`, 5e3);
      const health = JSON.parse(body);
      const countRes = await httpGet(`${digistBase}/api/items/count`, 3e3);
      const count = JSON.parse(countRes.body);
      results.digist = {
        status: "online",
        url: digistBase,
        health,
        items_count: count.count ?? count
      };
    } catch (err) {
      results.digist = {
        status: "offline",
        error: err instanceof Error ? err.message : String(err)
      };
    }
    try {
      const ragBase = await getKnowLeverRagBase();
      const { status } = await httpGet(`${ragBase}/api/health`, 3e3);
      results.knowlever_rag = {
        status: status === 200 ? "online" : "degraded",
        url: ragBase
      };
    } catch {
      results.knowlever_rag = { status: "offline (HTTP)", note: "Python subprocess fallback available" };
    }
    try {
      const klDir = getKnowLeverDir();
      const RAG_TEST = `
import sys, json
sys.path.insert(0, sys.argv[1])
from rag.pipeline import RAGPipeline
p = RAGPipeline()
print(json.dumps({"ok": True, "index_size": getattr(p, '_index_size', 'unknown')}))
`;
      const out = await runPythonScript(RAG_TEST, {}, 1e4);
      results.knowlever_python = { status: "available", dir: klDir, response: out };
    } catch (err) {
      results.knowlever_python = {
        status: "unavailable",
        error: err instanceof Error ? err.message : String(err)
      };
    }
    const sotagentBase = process.env.SOTAGENT_URL ?? "http://127.0.0.1:4800";
    try {
      const { body } = await httpGet(`${sotagentBase}/api/ports`, 3e3);
      const ports = JSON.parse(body);
      results.port_sdk = {
        status: "online",
        registered_services: ports.length,
        services: ports.map((p) => ({
          name: p.service_name,
          port: p.port,
          project: p.project
        }))
      };
    } catch {
      results.port_sdk = { status: "offline" };
    }
    const online = Object.values(results).filter(
      (v) => v.status === "online"
    ).length;
    const total = Object.keys(results).length;
    return {
      summary: `${online}/${total} services online`,
      services: results
    };
  }
};
var ecosystemSyncDigest = {
  name: "ecosystem_sync_digest",
  description: "\u5C06 digist \u5DF2\u91C7\u96C6\u7684\u5185\u5BB9\u540C\u6B65\u5230 KnowLever \u77E5\u8BC6\u5E93\u3002\u8C03\u7528 digist \u7684 sync-to-knowlever \u63A5\u53E3\uFF0C\u6309\u9886\u57DF\uFF08\u5174\u8DA3\uFF09\u5206\u7C7B\u63A8\u9001\u3002",
  parameters: {
    type: "object",
    properties: {
      interest: {
        type: "string",
        description: "\u6307\u5B9A\u540C\u6B65\u7684\u5174\u8DA3\u9886\u57DF\uFF08\u4E0D\u6307\u5B9A\u5219\u540C\u6B65\u5168\u90E8\uFF09"
      },
      days: {
        type: "number",
        description: "\u540C\u6B65\u6700\u8FD1 N \u5929\u7684\u5185\u5BB9\uFF08\u9ED8\u8BA4 7\uFF09"
      }
    }
  },
  async handler(args) {
    const digistBase = await getDigistBase();
    const payload = {};
    if (args.interest) payload.interest = String(args.interest);
    if (args.days) payload.days = Number(args.days);
    try {
      const { status, body } = await httpPost(
        `${digistBase}/api/sync-to-knowlever`,
        payload,
        6e4
      );
      if (status >= 400) {
        return { success: false, error: body };
      }
      return { success: true, result: JSON.parse(body) };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }
};
var ecosystemDiscoverAndLearn = {
  name: "ecosystem_discover_and_learn",
  description: "\u5B8C\u6574\u7684\u53D1\u73B0-\u5B66\u4E60\u6D41\u6C34\u7EBF\uFF1A1) \u7528 digist \u722C\u53D6\u6307\u5B9A\u5E73\u53F0\u7684\u65B0\u5185\u5BB9 2) \u540C\u6B65\u5230 KnowLever \u77E5\u8BC6\u5E93 3) \u53EF\u9009\uFF1A\u89E6\u53D1 LLM \u77E5\u8BC6\u7F16\u8BD1\u3002\u4E00\u7AD9\u5F0F\u4ECE\u4FE1\u606F\u91C7\u96C6\u5230\u77E5\u8BC6\u6C89\u6DC0\u3002",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        description: "\u722C\u53D6\u5E73\u53F0\uFF08hackernews, arxiv, reddit, bloomberg, github\uFF09"
      },
      query: {
        type: "string",
        description: "\u641C\u7D22\u5173\u952E\u8BCD\uFF08\u90E8\u5206\u5E73\u53F0\u4E0D\u9700\u8981\uFF0C\u5982 hackernews\uFF09"
      },
      compile: {
        type: "boolean",
        description: "\u662F\u5426\u5728\u540C\u6B65\u540E\u89E6\u53D1 KnowLever \u7F16\u8BD1\uFF08\u9ED8\u8BA4 false\uFF0C\u7F16\u8BD1\u8F83\u6162\uFF09"
      },
      topic: {
        type: "string",
        description: "\u540C\u6B65\u5230\u7684 KnowLever Topic \u540D\uFF08\u9ED8\u8BA4\u6309 digist \u5174\u8DA3\u81EA\u52A8\u6620\u5C04\uFF09"
      }
    },
    required: ["platform"]
  },
  async handler(args) {
    const digistBase = await getDigistBase();
    const steps = [];
    const crawlPayload = { platform: String(args.platform) };
    if (args.query) crawlPayload.query = String(args.query);
    try {
      const { status, body } = await httpPost(
        `${digistBase}/api/crawl/trigger`,
        crawlPayload,
        6e4
      );
      const result = JSON.parse(body);
      steps.push({
        step: "crawl",
        status: status < 400 ? "done" : "failed",
        detail: result
      });
    } catch (err) {
      steps.push({
        step: "crawl",
        status: "error",
        detail: err instanceof Error ? err.message : String(err)
      });
      return { success: false, steps };
    }
    try {
      const syncPayload = {};
      if (args.topic) syncPayload.interest = String(args.topic);
      const { status, body } = await httpPost(
        `${digistBase}/api/sync-to-knowlever`,
        syncPayload,
        6e4
      );
      steps.push({
        step: "sync_to_knowlever",
        status: status < 400 ? "done" : "failed",
        detail: JSON.parse(body)
      });
    } catch (err) {
      steps.push({
        step: "sync_to_knowlever",
        status: "error",
        detail: err instanceof Error ? err.message : String(err)
      });
    }
    if (args.compile && args.topic) {
      try {
        const klDir = getKnowLeverDir();
        const { stdout } = await execFileAsync(
          process.execPath,
          [resolve2(klDir, "wiki-engine/compile.js"), "--topic", String(args.topic), "--user", "admin", "--limit", "5"],
          { timeout: 3e5, cwd: klDir }
        );
        steps.push({ step: "compile", status: "done", detail: stdout.trim() });
      } catch (err) {
        steps.push({
          step: "compile",
          status: "error",
          detail: err instanceof Error ? err.message : String(err)
        });
      }
    }
    const allDone = steps.every((s) => s.status === "done");
    return { success: allDone, steps };
  }
};
var RAG_QUERY_SCRIPT = `
import json, sys
sys.path.insert(0, sys.argv[1])
payload = json.loads(sys.argv[2])
from rag.pipeline import RAGPipeline
pipeline = RAGPipeline()
context = pipeline.build_context(query=payload["query"], top_k=payload.get("top_k", 3))
print(context)
`;
var ecosystemUnifiedSearch = {
  name: "ecosystem_unified_search",
  description: "\u8DE8\u7CFB\u7EDF\u7EDF\u4E00\u641C\u7D22\uFF1A\u540C\u65F6\u67E5\u8BE2 digist\uFF08\u539F\u59CB\u722C\u53D6\u6570\u636E\uFF09\u548C KnowLever\uFF08\u7ED3\u6784\u5316\u77E5\u8BC6\uFF09\uFF0C\u5408\u5E76\u8FD4\u56DE\u6700\u76F8\u5173\u7684\u7ED3\u679C\u3002\u9002\u5408\u9700\u8981\u5168\u9762\u4FE1\u606F\u68C0\u7D22\u7684\u573A\u666F\u3002",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "\u641C\u7D22\u67E5\u8BE2\uFF08\u81EA\u7136\u8BED\u8A00\u95EE\u9898\u6216\u5173\u952E\u8BCD\uFF09" },
      top_k: { type: "number", description: "\u6BCF\u4E2A\u6570\u636E\u6E90\u8FD4\u56DE\u7684\u6700\u5927\u7ED3\u679C\u6570\uFF08\u9ED8\u8BA4 3\uFF09" }
    },
    required: ["query"]
  },
  async handler(args) {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("query \u4E0D\u80FD\u4E3A\u7A7A");
    const topK = Math.min(10, Math.max(1, Number(args.top_k) || 3));
    const results = {};
    const digistBase = await getDigistBase();
    try {
      const { body } = await httpGet(
        `${digistBase}/api/items/recent?limit=${topK * 3}&q=${encodeURIComponent(query)}`,
        8e3
      );
      const items = JSON.parse(body);
      results.digist = {
        source: "digist (raw items)",
        count: Array.isArray(items) ? items.length : items.items?.length ?? 0,
        items: Array.isArray(items) ? items.slice(0, topK) : (items.items ?? []).slice(0, topK)
      };
    } catch (err) {
      results.digist = {
        source: "digist",
        error: err instanceof Error ? err.message : String(err)
      };
    }
    try {
      const context = await runPythonScript(RAG_QUERY_SCRIPT, { query, top_k: topK }, 15e3);
      results.knowlever = {
        source: "KnowLever RAG (compiled knowledge)",
        context: context.slice(0, 3e3)
      };
    } catch (err) {
      results.knowlever = {
        source: "KnowLever RAG",
        error: err instanceof Error ? err.message : String(err)
      };
    }
    return { query, results };
  }
};
var ecosystemTools = [
  ecosystemStatus,
  ecosystemSyncDigest,
  ecosystemDiscoverAndLearn,
  ecosystemUnifiedSearch
];
export {
  ecosystemDiscoverAndLearn,
  ecosystemStatus,
  ecosystemSyncDigest,
  ecosystemTools,
  ecosystemUnifiedSearch
};
