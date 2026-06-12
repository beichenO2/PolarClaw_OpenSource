// skills/lab-report/tools.ts
import { execFile } from "node:child_process";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
var execFileAsync = promisify(execFile);
var PP_URL = process.env.POLARPRIVATE_URL ?? "http://127.0.0.1:12790";
var LLM_BASE = process.env.POLARCLAW_LLM_BASE_URL ?? `${PP_URL}/v1`;
var LLM_MODEL = process.env.LAB_REPORT_MODEL ?? process.env.POLARCLAW_MODEL_GENERAL ?? "qwen3.6-plus";
var LLM_TIMEOUT_MS = 12e4;
async function callLLM(messages, maxTokens = 3e3) {
  const url = `${LLM_BASE}/chat/completions`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS)
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
      const data = await res.json();
      let content = data.choices[0].message.content;
      content = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
      return content;
    } catch (err) {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 3e3));
      else throw err;
    }
  }
  throw new Error("LLM call failed after 3 attempts");
}
async function officecli(...args) {
  try {
    return await execFileAsync("~/.local/bin/officecli", args, { timeout: 3e4 });
  } catch (err) {
    const e = err;
    return { stdout: e.stdout ?? "", stderr: e.stderr ?? String(err) };
  }
}
async function generateContent(input) {
  const systemPrompt = input.systemPrompt ?? "\u4F60\u662F\u4E00\u540D\u5927\u5B66\u751F\uFF0C\u6B63\u5728\u64B0\u5199\u5B9E\u9A8C\u62A5\u544A\u3002\u8BF7\u6839\u636E\u63D0\u4F9B\u7684\u5B9E\u9A8C\u80CC\u666F\u8D44\u6599\uFF0C\u7528\u4E13\u4E1A\u3001\u51C6\u786E\u3001\u7B80\u6D01\u7684\u4E2D\u6587\u64B0\u5199\u6307\u5B9A\u7AE0\u8282\u5185\u5BB9\u3002\u76F4\u63A5\u8F93\u51FA\u7AE0\u8282\u6B63\u6587\u5185\u5BB9\uFF0C\u4E0D\u8981\u52A0\u989D\u5916\u8BF4\u660E\u6216\u6807\u9898\u884C\u3002";
  const content = {};
  for (const sec of input.sections) {
    if (sec.fixedContent) {
      content[sec.key] = sec.fixedContent;
      continue;
    }
    const messages = [
      { role: "system", content: systemPrompt },
      {
        role: "user",
        content: `${input.experimentContext}

${sec.prompt}`
      }
    ];
    content[sec.key] = await callLLM(messages, sec.maxTokens ?? 3e3);
  }
  return content;
}
async function buildDocument(input, content) {
  const out = resolve(input.outputPath);
  await mkdir(dirname(out), { recursive: true });
  await copyFile(input.templatePath, out);
  await officecli("open", out);
  const tmap = input.templateMap ?? {};
  for (const sec of input.sections) {
    const text = content[sec.key];
    if (!text) continue;
    const mapping = tmap[sec.key];
    if (!mapping) continue;
    for (const pid of mapping.removeParaIds) {
      for (let i = 0; i < 5; i++) {
        const { stdout } = await officecli("remove", out, `/body/p[@paraId=${pid}]`);
        if (stdout.toLowerCase().includes("not found") || stdout.toLowerCase().includes("no element")) break;
      }
    }
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const line of [...lines].reverse()) {
      const res = await officecli(
        "add",
        out,
        "/body",
        "--type",
        "paragraph",
        "--prop",
        `text=${line}`,
        "--after",
        `/body/p[@paraId=${mapping.headingParaId}]`
      );
      if (res.stderr) console.error(`[officecli error] ${res.stderr}`);
    }
  }
  if (input.images?.length) {
    const anchor = input.imageAnchorParaId ? `/body/p[@paraId=${input.imageAnchorParaId}]` : void 0;
    for (const img of input.images) {
      const imgArgs = [
        "add",
        out,
        "/body",
        "--type",
        "image",
        "--prop",
        `src=${img.path}`,
        "--prop",
        `width=${img.width ?? "13cm"}`
      ];
      if (anchor) imgArgs.push("--before", anchor);
      await officecli(...imgArgs);
      const capArgs = [
        "add",
        out,
        "/body",
        "--type",
        "paragraph",
        "--prop",
        `text=${img.caption}`
      ];
      if (anchor) capArgs.push("--before", anchor);
      await officecli(...capArgs);
    }
  }
  await officecli("close", out);
  return out;
}
async function validateDocument(docPath) {
  const [stats, outline, validation] = await Promise.all([
    officecli("view", docPath, "stats"),
    officecli("view", docPath, "outline"),
    officecli("validate", docPath)
  ]);
  return {
    stats: stats.stdout,
    outline: outline.stdout,
    warnings: validation.stderr.trim()
  };
}
var labReportGenerate = {
  name: "lab_report_generate",
  description: "\u5B8C\u6574\u5B9E\u9A8C\u62A5\u544A\u751F\u6210\u5DE5\u4F5C\u6D41\uFF1ALLM \u751F\u6210\u5404\u7AE0\u8282\u5185\u5BB9 \u2192 officecli \u7EC4\u88C5 .docx \u6587\u6863 \u2192 \u63D2\u5165\u5B9E\u9A8C\u56FE\u7247 \u2192 \u9A8C\u8BC1\u3002\u9700\u63D0\u4F9B\u5B9E\u9A8C\u80CC\u666F\u3001\u6A21\u677F\u8DEF\u5F84\u3001\u7AE0\u8282\u5B9A\u4E49\u3001\u56FE\u7247\u5217\u8868\u7B49\u3002",
  parameters: {
    type: "object",
    properties: {
      experiment_context: {
        type: "string",
        description: "\u5B9E\u9A8C\u80CC\u666F\u8D44\u6599\uFF08Markdown\uFF09\uFF0C\u5305\u542B\u5B9E\u9A8C\u7C7B\u578B\u3001\u8BBE\u5907\u3001\u539F\u7406\u3001\u6D4B\u91CF\u7ED3\u679C\u7B49"
      },
      system_prompt: {
        type: "string",
        description: "(\u53EF\u9009) LLM system prompt \u8986\u76D6"
      },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string", description: "\u7AE0\u8282\u6807\u8BC6\u952E" },
            heading: { type: "string", description: "\u7AE0\u8282\u6807\u9898" },
            prompt: { type: "string", description: "LLM \u751F\u6210\u63D0\u793A\u8BCD" },
            max_tokens: { type: "number", description: "\u6700\u5927 token \u6570\uFF08\u9ED8\u8BA4 3000\uFF09" },
            fixed_content: { type: "string", description: "(\u53EF\u9009) \u56FA\u5B9A\u5185\u5BB9\uFF0C\u8DF3\u8FC7 LLM" }
          },
          required: ["key", "heading", "prompt"]
        },
        description: "\u5F85\u751F\u6210\u7684\u7AE0\u8282\u5B9A\u4E49\u5217\u8868"
      },
      template_path: {
        type: "string",
        description: ".docx \u6A21\u677F\u6587\u4EF6\u7684\u7EDD\u5BF9\u8DEF\u5F84"
      },
      output_path: {
        type: "string",
        description: "\u8F93\u51FA .docx \u6587\u4EF6\u7684\u7EDD\u5BF9\u8DEF\u5F84"
      },
      images: {
        type: "array",
        items: {
          type: "object",
          properties: {
            path: { type: "string", description: "\u56FE\u7247\u7EDD\u5BF9\u8DEF\u5F84" },
            caption: { type: "string", description: "\u56FE\u7247\u8BF4\u660E\u6587\u5B57" },
            width: { type: "string", description: "\u56FE\u7247\u5BBD\u5EA6\uFF08\u9ED8\u8BA4 13cm\uFF09" }
          },
          required: ["path", "caption"]
        },
        description: "(\u53EF\u9009) \u8981\u63D2\u5165\u7684\u5B9E\u9A8C\u56FE\u7247\u5217\u8868"
      },
      image_anchor_para_id: {
        type: "string",
        description: "(\u53EF\u9009) \u56FE\u7247\u63D2\u5165\u951A\u70B9\u7684 paraId"
      },
      template_map: {
        type: "object",
        description: "(\u53EF\u9009) \u7AE0\u8282 key \u2192 {headingParaId, removeParaIds[]} \u7684\u6620\u5C04\uFF0C\u63A7\u5236\u6A21\u677F\u4E2D\u6BB5\u843D\u7684\u5220\u9664\u548C\u63D2\u5165\u4F4D\u7F6E"
      },
      cache_path: {
        type: "string",
        description: "(\u53EF\u9009) JSON \u7F13\u5B58\u8DEF\u5F84\u3002\u5982\u679C\u6587\u4EF6\u5B58\u5728\u5219\u8DF3\u8FC7 LLM \u751F\u6210\uFF0C\u76F4\u63A5\u6784\u5EFA\u6587\u6863"
      }
    },
    required: ["experiment_context", "sections", "template_path", "output_path"]
  },
  async handler(args) {
    const input = {
      experimentContext: String(args.experiment_context ?? ""),
      systemPrompt: args.system_prompt ? String(args.system_prompt) : void 0,
      sections: args.sections.map((s) => ({
        key: String(s.key),
        heading: String(s.heading),
        prompt: String(s.prompt ?? ""),
        maxTokens: s.max_tokens ? Number(s.max_tokens) : void 0,
        fixedContent: s.fixed_content ? String(s.fixed_content) : void 0
      })),
      templatePath: String(args.template_path),
      outputPath: String(args.output_path),
      images: args.images ? args.images.map((img) => ({
        path: String(img.path),
        caption: String(img.caption),
        width: img.width ? String(img.width) : void 0
      })) : void 0,
      imageAnchorParaId: args.image_anchor_para_id ? String(args.image_anchor_para_id) : void 0,
      templateMap: args.template_map
    };
    const cachePath = args.cache_path ? String(args.cache_path) : void 0;
    let content;
    if (cachePath) {
      try {
        const cached = await readFile(cachePath, "utf8");
        content = JSON.parse(cached);
      } catch {
        content = await generateContent(input);
        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, JSON.stringify(content, null, 2), "utf8");
      }
    } else {
      content = await generateContent(input);
    }
    const outputPath = await buildDocument(input, content);
    const validation = await validateDocument(outputPath);
    return {
      success: true,
      output_path: outputPath,
      sections_generated: Object.keys(content).length,
      section_lengths: Object.fromEntries(
        Object.entries(content).map(([k, v]) => [k, v.length])
      ),
      validation
    };
  }
};
var labReportPreview = {
  name: "lab_report_preview",
  description: "\u4EC5\u8FD0\u884C LLM \u5185\u5BB9\u751F\u6210\uFF08\u4E0D\u6784\u5EFA\u6587\u6863\uFF09\uFF0C\u8FD4\u56DE\u5404\u7AE0\u8282\u6587\u672C\u3002\u7528\u4E8E\u9884\u89C8\u548C\u8C03\u6574\u540E\u518D\u6B63\u5F0F\u6784\u5EFA\u3002",
  parameters: {
    type: "object",
    properties: {
      experiment_context: {
        type: "string",
        description: "\u5B9E\u9A8C\u80CC\u666F\u8D44\u6599\uFF08Markdown\uFF09"
      },
      system_prompt: {
        type: "string",
        description: "(\u53EF\u9009) LLM system prompt \u8986\u76D6"
      },
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            key: { type: "string" },
            heading: { type: "string" },
            prompt: { type: "string" },
            max_tokens: { type: "number" },
            fixed_content: { type: "string" }
          },
          required: ["key", "heading", "prompt"]
        },
        description: "\u5F85\u751F\u6210\u7684\u7AE0\u8282\u5B9A\u4E49\u5217\u8868"
      }
    },
    required: ["experiment_context", "sections"]
  },
  async handler(args) {
    const input = {
      experimentContext: String(args.experiment_context ?? ""),
      systemPrompt: args.system_prompt ? String(args.system_prompt) : void 0,
      sections: args.sections.map((s) => ({
        key: String(s.key),
        heading: String(s.heading),
        prompt: String(s.prompt ?? ""),
        maxTokens: s.max_tokens ? Number(s.max_tokens) : void 0,
        fixedContent: s.fixed_content ? String(s.fixed_content) : void 0
      })),
      templatePath: "",
      outputPath: ""
    };
    const content = await generateContent(input);
    return {
      success: true,
      sections: Object.fromEntries(
        Object.entries(content).map(([k, v]) => [k, { length: v.length, text: v }])
      )
    };
  }
};
var labReportHealth = {
  name: "lab_report_health",
  description: "\u68C0\u67E5 lab-report skill \u4F9D\u8D56\u72B6\u6001\uFF1Aofficecli \u662F\u5426\u53EF\u7528\u3001LLM Proxy \u662F\u5426\u8FDE\u901A\u3002",
  parameters: { type: "object", properties: {} },
  async handler() {
    const checks = {};
    try {
      const { stdout } = await execFileAsync("officecli", ["--version"], { timeout: 5e3 });
      checks.officecli = { available: true, version: stdout.trim() };
    } catch {
      checks.officecli = { available: false };
    }
    try {
      const testUrl = `${LLM_BASE}/chat/completions`;
      const res = await fetch(testUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: LLM_MODEL, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
        signal: AbortSignal.timeout(1e4)
      });
      checks.llm_proxy = { reachable: res.ok, url: LLM_BASE, model: LLM_MODEL };
    } catch {
      checks.llm_proxy = { reachable: false, url: LLM_BASE };
    }
    return checks;
  }
};
var labReportTools = [
  labReportGenerate,
  labReportPreview,
  labReportHealth
];
export {
  labReportGenerate,
  labReportHealth,
  labReportPreview,
  labReportTools
};
