// skills/knowlever-integration/tools.ts
import { execFile, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { readdirSync, existsSync, statSync } from "node:fs";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var PYTHON_CANDIDATES = ["/opt/homebrew/bin/python3", "python3"];
function getKnowLeverDir() {
  const env = process.env.KNOWLEVER_DIR?.trim();
  if (env) return resolve(env);
  const home = process.env.HOME ?? "~";
  return resolve(home, "Polarisor/KnowLever");
}
function findPython() {
  const klDir = getKnowLeverDir();
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const { status } = spawnSync(candidate, [
        "-c",
        `import sys; sys.path.insert(0, sys.argv[1]); import rag.pipeline`,
        klDir
      ], { stdio: "pipe" });
      if (status === 0) return candidate;
    } catch {
    }
  }
  for (const candidate of PYTHON_CANDIDATES) {
    try {
      const { status } = spawnSync(candidate, ["--version"], { stdio: "pipe" });
      if (status === 0) return candidate;
    } catch {
    }
  }
  return "python3";
}
async function runPythonScript(script, payload, timeoutMs = 15e3) {
  const klDir = getKnowLeverDir();
  const python = findPython();
  return execFileAsync(python, ["-c", script, klDir, JSON.stringify(payload)], {
    timeout: timeoutMs,
    cwd: klDir
  });
}
var RAG_QUERY_SCRIPT = `
import json, sys
sys.path.insert(0, sys.argv[1])
payload = json.loads(sys.argv[2])
from rag.pipeline import RAGPipeline
pipeline = RAGPipeline()
context = pipeline.build_context(query=payload["query"], top_k=payload["top_k"])
print(context)
`;
var RAG_INGEST_SCRIPT = `
import json, sys
sys.path.insert(0, sys.argv[1])
payload = json.loads(sys.argv[2])
from rag.pipeline import RAGPipeline
pipeline = RAGPipeline()
pipeline.ingest_document(text=payload["text"], doc_id=payload["doc_id"])
print("OK")
`;
var knowleverQuery = {
  name: "knowlever_query",
  description: "\u4ECE KnowLever \u77E5\u8BC6\u5E93\u4E2D\u68C0\u7D22\u76F8\u5173\u4E0A\u4E0B\u6587\u3002\u4F7F\u7528 BM25 + \u5411\u91CF\u6DF7\u5408\u68C0\u7D22\u3002\u9002\u5408\u9700\u8981\u80CC\u666F\u77E5\u8BC6\u3001\u53C2\u8003\u8D44\u6599\u3001\u4E8B\u5B9E\u6838\u67E5\u7684\u573A\u666F\u3002",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "\u68C0\u7D22\u67E5\u8BE2\uFF08\u81EA\u7136\u8BED\u8A00\u95EE\u9898\u6216\u5173\u952E\u8BCD\uFF09" },
      top_k: { type: "number", description: "\u8FD4\u56DE\u7ED3\u679C\u6570\u91CF\uFF08\u9ED8\u8BA4 3\uFF0C\u6700\u5927 10\uFF09" }
    },
    required: ["query"]
  },
  async handler(args) {
    const query = String(args.query ?? "").trim();
    if (!query) throw new Error("query \u4E0D\u80FD\u4E3A\u7A7A");
    const topK = Math.min(10, Math.max(1, Number(args.top_k) || 3));
    try {
      const { stdout, stderr } = await runPythonScript(
        RAG_QUERY_SCRIPT,
        { query, top_k: topK }
      );
      if (stderr && stderr.includes("ERROR:")) {
        return { success: false, error: stderr.trim(), query };
      }
      return { success: true, context: stdout.trim(), query };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg, query };
    }
  }
};
var knowleverListTopics = {
  name: "knowlever_list_topics",
  description: "\u5217\u51FA KnowLever \u77E5\u8BC6\u5E93\u4E2D\u6240\u6709\u53EF\u7528\u7684 Topic\uFF08\u77E5\u8BC6\u4E3B\u9898\uFF09\u3002",
  parameters: { type: "object", properties: {} },
  async handler() {
    const klDir = getKnowLeverDir();
    const dataDir = resolve(klDir, "data/users");
    if (!existsSync(dataDir)) {
      return { topics: [], error: "KnowLever data \u76EE\u5F55\u4E0D\u5B58\u5728" };
    }
    const topics = [];
    try {
      for (const user of readdirSync(dataDir)) {
        const userDir = resolve(dataDir, user);
        if (!statSync(userDir).isDirectory()) continue;
        const topicsDir = resolve(userDir, "topics");
        if (!existsSync(topicsDir)) continue;
        for (const topic of readdirSync(topicsDir)) {
          const topicDir = resolve(topicsDir, topic);
          if (statSync(topicDir).isDirectory()) {
            topics.push({ user, topic, path: topicDir });
          }
        }
      }
    } catch (err) {
      return { topics: [], error: err instanceof Error ? err.message : String(err) };
    }
    return { topics, total: topics.length };
  }
};
var knowleverIngest = {
  name: "knowlever_ingest",
  description: "\u5C06\u6587\u672C\u6444\u5165 KnowLever \u77E5\u8BC6\u5E93\uFF0C\u5EFA\u7ACB\u68C0\u7D22\u7D22\u5F15\u3002\u9002\u5408\u4FDD\u5B58\u91CD\u8981\u7B14\u8BB0\u6216\u6587\u6863\u3002",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "\u8981\u6444\u5165\u7684\u6587\u672C\u5185\u5BB9" },
      doc_id: { type: "string", description: "\u6587\u6863 ID\uFF08\u552F\u4E00\u6807\u8BC6\uFF0C\u5982 note-2026-04-15\uFF09" }
    },
    required: ["text", "doc_id"]
  },
  async handler(args) {
    const text = String(args.text ?? "").trim();
    const docId = String(args.doc_id ?? "").trim();
    if (!text) throw new Error("text \u4E0D\u80FD\u4E3A\u7A7A");
    if (!docId) throw new Error("doc_id \u4E0D\u80FD\u4E3A\u7A7A");
    try {
      const { stderr } = await runPythonScript(
        RAG_INGEST_SCRIPT,
        { text: text.slice(0, 1e4), doc_id: docId },
        3e4
      );
      const success = !stderr || !stderr.includes("ERROR:");
      return { success, doc_id: docId };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
};
async function runNodeScript(scriptPath, args, timeoutMs = 3e4) {
  const klDir = getKnowLeverDir();
  return execFileAsync(process.execPath, [resolve(klDir, scriptPath), ...args], {
    timeout: timeoutMs,
    cwd: klDir
  });
}
var knowleverIngestCodebase = {
  name: "knowlever_ingest_codebase",
  description: "\u5C06\u4EE3\u7801\u5E93\uFF08\u5F00\u6E90\u9879\u76EE\uFF09\u6444\u5165 KnowLever\u3002\u652F\u6301\u672C\u5730\u76EE\u5F55\u8DEF\u5F84\u6216 Git URL\u3002\u4F1A\u81EA\u52A8\u8BC6\u522B\u9879\u76EE\u7ED3\u6784\u3001\u8BED\u8A00\u3001\u6846\u67B6\uFF0C\u751F\u6210\u89C4\u8303\u5316\u7684\u77E5\u8BC6\u6587\u6863\u3002",
  parameters: {
    type: "object",
    properties: {
      input: {
        type: "string",
        description: "\u4EE3\u7801\u5E93\u8DEF\u5F84\uFF08\u672C\u5730\u76EE\u5F55\uFF09\u6216 Git URL\uFF08\u5982 https://github.com/user/repo.git\uFF09"
      },
      topic: {
        type: "string",
        description: "Topic \u540D\u79F0\uFF08\u77E5\u8BC6\u4E3B\u9898\uFF0C\u5982 react-source\u3001my-lib\uFF09"
      },
      user: {
        type: "string",
        description: "\u7528\u6237\u540D\uFF08\u9ED8\u8BA4 admin\uFF09"
      }
    },
    required: ["input", "topic"]
  },
  async handler(args) {
    const input = String(args.input ?? "").trim();
    const topic = String(args.topic ?? "").trim();
    const user = String(args.user ?? "admin").trim();
    if (!input) throw new Error("input \u4E0D\u80FD\u4E3A\u7A7A");
    if (!topic) throw new Error("topic \u4E0D\u80FD\u4E3A\u7A7A");
    try {
      const nodeArgs = [input, "--topic", topic, "--user", user, "--from-codebase"];
      const { stdout, stderr } = await runNodeScript(
        "wiki-engine/ingest.js",
        nodeArgs,
        12e4
      );
      const success = !stderr || !stderr.includes("[error]");
      return { success, output: stdout.trim(), topic, input };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        topic,
        input
      };
    }
  }
};
var knowleverCompile = {
  name: "knowlever_compile",
  description: "\u5BF9\u5DF2\u6444\u5165\u7684 Topic \u8FD0\u884C LLM \u77E5\u8BC6\u7F16\u8BD1\uFF0C\u5C06\u539F\u59CB\u5185\u5BB9\u8F6C\u5316\u4E3A\u7ED3\u6784\u5316\u3001\u4E92\u94FE\u7684 wiki \u9875\u9762\u3002\u4EE3\u7801\u5E93\u7C7B\u578B\u4F1A\u81EA\u52A8\u4F7F\u7528\u67B6\u6784\u5206\u6790\u4E13\u7528\u63D0\u793A\u8BCD\u3002\u9700\u8981 PolarPrivate LLM \u670D\u52A1\u8FD0\u884C\u3002",
  parameters: {
    type: "object",
    properties: {
      topic: {
        type: "string",
        description: "Topic \u540D\u79F0"
      },
      user: {
        type: "string",
        description: "\u7528\u6237\u540D\uFF08\u9ED8\u8BA4 admin\uFF09"
      },
      source: {
        type: "string",
        description: "\u7F16\u8BD1\u7279\u5B9A source ID\uFF08\u4E0D\u6307\u5B9A\u5219\u7F16\u8BD1\u6240\u6709\u672A\u7F16\u8BD1\u7684 source\uFF09"
      },
      force: {
        type: "boolean",
        description: "\u662F\u5426\u5F3A\u5236\u91CD\u65B0\u7F16\u8BD1\u5DF2\u7F16\u8BD1\u7684 source\uFF08\u9ED8\u8BA4 false\uFF09"
      },
      dry_run: {
        type: "boolean",
        description: "\u4EC5\u5206\u6790\u4E0D\u5199\u5165\u6587\u4EF6\uFF08\u9ED8\u8BA4 false\uFF09"
      },
      limit: {
        type: "number",
        description: "\u6700\u5927\u7F16\u8BD1 source \u6570\u91CF"
      }
    },
    required: ["topic"]
  },
  async handler(args) {
    const topic = String(args.topic ?? "").trim();
    const user = String(args.user ?? "admin").trim();
    if (!topic) throw new Error("topic \u4E0D\u80FD\u4E3A\u7A7A");
    const nodeArgs = ["--topic", topic, "--user", user];
    if (args.source) nodeArgs.push("--source", String(args.source));
    if (args.force) nodeArgs.push("--force");
    if (args.dry_run) nodeArgs.push("--dry-run");
    if (args.limit) nodeArgs.push("--limit", String(args.limit));
    try {
      const { stdout, stderr } = await runNodeScript(
        "wiki-engine/compile.js",
        nodeArgs,
        3e5
      );
      const success = !stderr || !stderr.includes("[fatal]");
      return { success, output: stdout.trim(), topic };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        topic
      };
    }
  }
};
var knowleverBuild = {
  name: "knowlever_build",
  description: "\u6784\u5EFA Topic \u7684\u9759\u6001 HTML \u7AD9\u70B9\u3002\u5C06 wiki/ \u4E0B\u7684 Markdown \u7F16\u8BD1\u4E3A\u53EF\u6D4F\u89C8\u7684\u7F51\u9875\u3002",
  parameters: {
    type: "object",
    properties: {
      topic: { type: "string", description: "Topic \u540D\u79F0" },
      user: { type: "string", description: "\u7528\u6237\u540D\uFF08\u9ED8\u8BA4 admin\uFF09" }
    },
    required: ["topic"]
  },
  async handler(args) {
    const topic = String(args.topic ?? "").trim();
    const user = String(args.user ?? "admin").trim();
    if (!topic) throw new Error("topic \u4E0D\u80FD\u4E3A\u7A7A");
    try {
      const { stdout, stderr } = await runNodeScript(
        "wiki-engine/build.js",
        ["--topic", topic, "--user", user],
        6e4
      );
      const success = !stderr || !stderr.includes("[error]");
      return { success, output: stdout.trim(), topic };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        topic
      };
    }
  }
};
var knowleverTools = [
  knowleverQuery,
  knowleverListTopics,
  knowleverIngest,
  knowleverIngestCodebase,
  knowleverCompile,
  knowleverBuild
];
export {
  knowleverBuild,
  knowleverCompile,
  knowleverIngest,
  knowleverIngestCodebase,
  knowleverListTopics,
  knowleverQuery,
  knowleverTools
};
