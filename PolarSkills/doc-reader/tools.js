// skills/doc-reader/tools.ts
import { execSync } from "node:child_process";
function runOfficecli(args, timeoutMs = 3e4) {
  try {
    return execSync(`officecli ${args}`, {
      encoding: "utf8",
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024
    }).trim();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`officecli \u6267\u884C\u5931\u8D25: ${msg}`);
  }
}
function parseJsonOutput(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
function extractTextFromNode(node, depth = 0) {
  const lines = [];
  const type = node.type;
  const preview = node.preview;
  if (preview) {
    const indent = "  ".repeat(depth);
    const prefix = type === "slide" ? `[${node.path}] ` : "";
    lines.push(`${indent}${prefix}${preview}`);
  }
  const children = node.children;
  if (children) {
    for (const child of children) {
      lines.push(...extractTextFromNode(child, depth + 1));
    }
  }
  return lines;
}
var tools = [
  {
    name: "doc_read",
    description: "\u8BFB\u53D6 Office \u6587\u6863\u7684\u6587\u672C\u5185\u5BB9\u3002\u652F\u6301 PPT(.pptx) \u9010\u9875\u8BFB\u53D6\u3001DOCX(.docx) \u6BB5\u843D\u8BFB\u53D6\u3001XLSX(.xlsx) \u5355\u5143\u683C\u8BFB\u53D6\u3002",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "\u6587\u6863\u6587\u4EF6\u8DEF\u5F84" },
        path: { type: "string", description: "\u6587\u6863\u5185\u8DEF\u5F84\uFF08\u5982 /slide[1]\u3001/body\uFF09\uFF0C\u9ED8\u8BA4\u8BFB\u53D6\u5168\u90E8" },
        max_depth: { type: "number", description: "\u9012\u5F52\u8BFB\u53D6\u6DF1\u5EA6\uFF08\u9ED8\u8BA4 3\uFF09" }
      },
      required: ["file_path"]
    },
    async handler(args) {
      const filePath = String(args.file_path);
      const docPath = String(args.path || "/");
      const maxDepth = Number(args.max_depth) || 3;
      const raw = runOfficecli(
        `get "${filePath}" "${docPath}" --json`,
        6e4
      );
      const result = parseJsonOutput(raw);
      if (result && typeof result === "object" && result.success === false) {
        throw new Error(`\u8BFB\u53D6\u5931\u8D25: ${JSON.stringify(result)}`);
      }
      const data = result.data ?? result;
      if (!data || typeof data !== "object") {
        return { text: raw, format: "raw" };
      }
      const textLines = extractTextFromNode(data, 0);
      const childCount = data.childCount;
      const type = data.type;
      return {
        type,
        path: docPath,
        childCount,
        text: textLines.join("\n"),
        textLineCount: textLines.length
      };
    }
  },
  {
    name: "doc_structure",
    description: "\u83B7\u53D6\u6587\u6863\u7ED3\u6784\u6982\u89C8\uFF1A\u5143\u6570\u636E\uFF08\u6807\u9898\u3001\u4F5C\u8005\u3001\u9875\u6570\uFF09\u548C\u5185\u5BB9\u5927\u7EB2\u3002\u7528\u4E8E\u5728\u8BFB\u53D6\u524D\u5148\u4E86\u89E3\u6587\u6863\u7EC4\u7EC7\u3002",
    parameters: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "\u6587\u6863\u6587\u4EF6\u8DEF\u5F84" }
      },
      required: ["file_path"]
    },
    async handler(args) {
      const filePath = String(args.file_path);
      const raw = runOfficecli(`get "${filePath}" / --json`, 6e4);
      const result = parseJsonOutput(raw);
      const data = result.data ?? result;
      const format = data.format;
      const children = data.children;
      const outline = [];
      if (children) {
        for (const child of children) {
          outline.push({
            path: String(child.path ?? ""),
            preview: String(child.preview ?? "").slice(0, 100),
            childCount: Number(child.childCount ?? 0)
          });
        }
      }
      return {
        type: data.type,
        childCount: data.childCount,
        metadata: format ? {
          title: format.title,
          author: format.author,
          lastModifiedBy: format.lastModifiedBy,
          created: format.created,
          modified: format.modified
        } : null,
        outline
      };
    }
  }
];
export {
  tools
};
