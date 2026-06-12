/**
 * AutoOffice Integration — 工具实现
 *
 * 通过 HTTP 调用 AutoOffice API（默认端口 3900）。
 * AutoOffice 内部已集成 KnowLever RAG，enrich 调用会自动触发知识检索。
 */

import type { IToolHandler } from '../../src/ports/tools.js';
import { getServiceUrl, SERVICES } from '../_shared/port-discovery.js';

async function getAutoOfficeBase(): Promise<string> {
  if (process.env.AUTOOFFICE_API_URL) return process.env.AUTOOFFICE_API_URL;
  return getServiceUrl(SERVICES.AUTOOFFICE.name, SERVICES.AUTOOFFICE.gateway);
}

let AUTOOFFICE_BASE = process.env.AUTOOFFICE_API_URL ?? 'http://127.0.0.1:3900';

(async () => {
  try { AUTOOFFICE_BASE = await getAutoOfficeBase(); } catch { /* keep fallback */ }
})();

async function aoFetch<T>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const { method = 'GET', body, timeoutMs = 30000 } = options;
  try {
    const init: RequestInit = {
      method,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    };
    if (body !== undefined) init.body = JSON.stringify(body);

    const res = await fetch(`${AUTOOFFICE_BASE}${path}`, init);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({})) as Record<string, unknown>;
      return { ok: false, error: String(errBody.error ?? `HTTP ${res.status}`) };
    }

    const contentType = res.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return { ok: true, data: await res.json() as T };
    }

    const buf = await res.arrayBuffer();
    return {
      ok: true,
      data: {
        base64: Buffer.from(buf).toString('base64'),
        contentType,
        size: buf.byteLength,
      } as T,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export const autoofficeHealth: IToolHandler = {
  name: 'autooffice_health',
  description: '检查 AutoOffice 服务是否在线。返回版本和状态。',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const result = await aoFetch<{ status: string; version: string }>('/health');
    if (!result.ok) return { online: false, error: result.error };
    return { online: true, ...result.data };
  },
};

export const autoofficeGenerateReport: IToolHandler = {
  name: 'autooffice_generate_report',
  description:
    '生成专业报告。支持格式：pptx, pdf, docx, latex, latex-pdf, html。' +
    '传入结构化数据（含 title + sections）。文件类格式自动保存到磁盘并返回路径。',
  parameters: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        enum: ['pptx', 'pdf', 'docx', 'latex', 'latex-pdf', 'html'],
        description: '输出格式。latex-pdf = LaTeX 编译为 PDF',
      },
      data: {
        type: 'object',
        description: '报告数据，需包含 title (string) 和 sections (array of {title, content})',
      },
      template: { type: 'string', description: '自定义 HTML 模板（可选）' },
      locale: { type: 'string', description: '语言地区（默认 zh-CN）' },
      output_path: { type: 'string', description: '输出路径（默认 ~/Desktop/report.{ext}）' },
    },
    required: ['format', 'data'],
  },
  async handler(args) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');

    const format = String(args.format ?? 'html');
    const body: Record<string, unknown> = {
      format,
      data: args.data,
      locale: args.locale ?? 'zh-CN',
    };
    if (args.template) body.template = args.template;

    const result = await aoFetch<Record<string, unknown>>('/api/generate', {
      method: 'POST',
      body,
      timeoutMs: 120000,
    });

    if (!result.ok) return { error: result.error };

    const d = result.data as Record<string, unknown>;
    const b64 = d.base64 ?? d.content ?? d.file;
    const extMap: Record<string, string> = { pptx: 'pptx', pdf: 'pdf', docx: 'docx', latex: 'tex', 'latex-pdf': 'pdf', html: 'html' };
    const ext = extMap[format] ?? format;

    if (typeof b64 === 'string' && b64.length > 100 && format !== 'html') {
      const outPath = resolve(String(args.output_path ?? `${process.env.HOME}/Desktop/report.${ext}`));
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, Buffer.from(b64, 'base64'));
      return { format, saved: true, path: outPath, sizeBytes: Buffer.from(b64, 'base64').length };
    }

    return { format, ...d };
  },
};

export const autoofficeSummarize: IToolHandler = {
  name: 'autooffice_summarize',
  description:
    '分析内容并生成 Mermaid 架构图。自动评估内容复杂度并路由建议（KnowLever Wiki 或 AutoOffice 报告）。' +
    '输入为文本片段数组。',
  parameters: {
    type: 'object',
    properties: {
      inputs: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', description: '类型：text / url / file' },
            content: { type: 'string', description: '文本内容或 URL' },
          },
          required: ['type', 'content'],
        },
        description: '待分析的内容片段列表',
      },
    },
    required: ['inputs'],
  },
  async handler(args) {
    const result = await aoFetch<Record<string, unknown>>('/api/summarize', {
      method: 'POST',
      body: { inputs: args.inputs },
      timeoutMs: 30000,
    });
    if (!result.ok) return { error: result.error };
    return result.data;
  },
};

export const autoofficeEnrich: IToolHandler = {
  name: 'autooffice_enrich',
  description:
    '使用 KnowLever RAG 知识库增强 Markdown 内容。自动提取关键主题，检索相关知识，追加到文档末尾。',
  parameters: {
    type: 'object',
    properties: {
      markdown: { type: 'string', description: '待增强的 Markdown 内容' },
      max_queries: { type: 'number', description: '最多检索几个主题（默认 3）' },
      top_k: { type: 'number', description: '每个主题返回几条结果（默认 3）' },
    },
    required: ['markdown'],
  },
  async handler(args) {
    const body: Record<string, unknown> = { markdown: String(args.markdown ?? '') };
    if (args.max_queries != null) body.maxQueries = args.max_queries;
    if (args.top_k != null) body.topK = args.top_k;

    const result = await aoFetch<Record<string, unknown>>('/api/enrich', {
      method: 'POST',
      body,
      timeoutMs: 30000,
    });
    if (!result.ok) return { error: result.error };
    return result.data;
  },
};

export const autoofficeCheckQuality: IToolHandler = {
  name: 'autooffice_check_quality',
  description:
    '分析文本质量：检测 AI 味（50+ 规则）、评估单调度和多样性。返回 A-F 评级和改进建议。',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '待分析的文本' },
    },
    required: ['text'],
  },
  async handler(args) {
    const result = await aoFetch<Record<string, unknown>>('/api/quality', {
      method: 'POST',
      body: { text: String(args.text ?? '') },
    });
    if (!result.ok) return { error: result.error };
    return result.data;
  },
};

export const autoofficeListTemplates: IToolHandler = {
  name: 'autooffice_list_templates',
  description: '列出 AutoOffice 可用的报告模板（商业报告、学术论文、幻灯片等）。',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const result = await aoFetch<{ templates: unknown[] }>('/api/templates');
    if (!result.ok) return { error: result.error };
    return result.data;
  },
};

export const autoofficeBatchGenerate: IToolHandler = {
  name: 'autooffice_batch_generate',
  description:
    '批量生成多种格式的报告（PPT + PDF + Word + LaTeX 等），一次调用同时产出多个文件。',
  parameters: {
    type: 'object',
    properties: {
      formats: {
        type: 'array',
        items: { type: 'string', enum: ['pptx', 'pdf', 'docx', 'latex', 'latex-pdf', 'html'] },
        description: '要生成的格式列表',
      },
      data: {
        type: 'object',
        description: '报告数据，需包含 title (string) 和 sections (array of {title, content})',
      },
      locale: { type: 'string', description: '语言地区（默认 zh-CN）' },
    },
    required: ['formats', 'data'],
  },
  async handler(args) {
    const formats = (args.formats as string[]) ?? ['html'];
    const results = await Promise.allSettled(
      formats.map(async (fmt) => {
        const body: Record<string, unknown> = {
          format: fmt,
          data: args.data,
          locale: args.locale ?? 'zh-CN',
        };
        const result = await aoFetch<Record<string, unknown>>('/api/generate', {
          method: 'POST',
          body,
          timeoutMs: 120000,
        });
        if (!result.ok) return { format: fmt, error: result.error };
        return { format: fmt, ...result.data };
      }),
    );
    return {
      results: results.map((r, i) => {
        if (r.status === 'fulfilled') return r.value;
        return { format: formats[i], error: String(r.reason) };
      }),
    };
  },
};

export const autoofficeGeneratePaper: IToolHandler = {
  name: 'autooffice_generate_paper',
  description:
    '生成学术论文 PDF。使用 LaTeX 编译。' +
    '传入论文数据，自动保存 PDF 到指定路径并返回文件路径。',
  parameters: {
    type: 'object',
    properties: {
      data: {
        type: 'object',
        description: '论文数据：{ title, abstract, sections: [{heading, body, math?}], references?: string[], latex?: { theme?, toc? } }',
      },
      locale: { type: 'string', description: '语言（默认 zh-CN）' },
      output_path: { type: 'string', description: '输出 PDF 路径（默认 ~/Desktop/paper.pdf）' },
    },
    required: ['data'],
  },
  async handler(args) {
    const { writeFileSync, mkdirSync } = await import('node:fs');
    const { dirname, resolve } = await import('node:path');

    const paperData = args.data as Record<string, unknown>;
    const body: Record<string, unknown> = {
      format: 'latex-pdf',
      data: paperData,
      locale: args.locale ?? 'zh-CN',
    };
    const result = await aoFetch<Record<string, unknown>>('/api/generate', {
      method: 'POST',
      body,
      timeoutMs: 180000,
    });
    if (!result.ok) return { error: result.error };

    const b64 = (result.data as any).content ?? (result.data as any).file;
    if (typeof b64 === 'string' && b64.length > 100) {
      const outPath = resolve(String(args.output_path ?? `${process.env.HOME}/Desktop/paper.pdf`));
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, Buffer.from(b64, 'base64'));
      return { format: 'latex-pdf', saved: true, path: outPath, sizeBytes: Buffer.from(b64, 'base64').length };
    }

    return { format: 'latex-pdf', ...result.data, note: 'base64 content returned but could not auto-save' };
  },
};

export const autoofficeTools: IToolHandler[] = [
  autoofficeHealth,
  autoofficeGenerateReport,
  autoofficeBatchGenerate,
  autoofficeGeneratePaper,
  autoofficeSummarize,
  autoofficeEnrich,
  autoofficeCheckQuality,
  autoofficeListTemplates,
];
