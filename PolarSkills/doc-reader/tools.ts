import { execSync } from 'node:child_process';

interface IToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

function runOfficecli(args: string, timeoutMs = 30000): string {
  try {
    return execSync(`officecli ${args}`, {
      encoding: 'utf8',
      timeout: timeoutMs,
      maxBuffer: 5 * 1024 * 1024,
    }).trim();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`officecli 执行失败: ${msg}`);
  }
}

function parseJsonOutput(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function extractTextFromNode(node: Record<string, unknown>, depth = 0): string[] {
  const lines: string[] = [];
  const type = node.type as string | undefined;
  const preview = node.preview as string | undefined;

  if (preview) {
    const indent = '  '.repeat(depth);
    const prefix = type === 'slide' ? `[${node.path}] ` : '';
    lines.push(`${indent}${prefix}${preview}`);
  }

  const children = node.children as Array<Record<string, unknown>> | undefined;
  if (children) {
    for (const child of children) {
      lines.push(...extractTextFromNode(child, depth + 1));
    }
  }

  return lines;
}

export const tools: IToolHandler[] = [
  {
    name: 'doc_read',
    description: '读取 Office 文档的文本内容。支持 PPT(.pptx) 逐页读取、DOCX(.docx) 段落读取、XLSX(.xlsx) 单元格读取。',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文档文件路径' },
        path: { type: 'string', description: '文档内路径（如 /slide[1]、/body），默认读取全部' },
        max_depth: { type: 'number', description: '递归读取深度（默认 3）' },
      },
      required: ['file_path'],
    },
    async handler(args) {
      const filePath = String(args.file_path);
      const docPath = String(args.path || '/');
      const maxDepth = Number(args.max_depth) || 3;

      const raw = runOfficecli(
        `get "${filePath}" "${docPath}" --json`,
        60000,
      );

      const result = parseJsonOutput(raw) as Record<string, unknown>;
      if (result && typeof result === 'object' && (result as { success?: boolean }).success === false) {
        throw new Error(`读取失败: ${JSON.stringify(result)}`);
      }

      const data = (result as { data?: Record<string, unknown> }).data ?? result;
      if (!data || typeof data !== 'object') {
        return { text: raw, format: 'raw' };
      }

      const textLines = extractTextFromNode(data as Record<string, unknown>, 0);

      const childCount = (data as Record<string, unknown>).childCount as number | undefined;
      const type = (data as Record<string, unknown>).type as string | undefined;

      return {
        type,
        path: docPath,
        childCount,
        text: textLines.join('\n'),
        textLineCount: textLines.length,
      };
    },
  },
  {
    name: 'doc_structure',
    description: '获取文档结构概览：元数据（标题、作者、页数）和内容大纲。用于在读取前先了解文档组织。',
    parameters: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: '文档文件路径' },
      },
      required: ['file_path'],
    },
    async handler(args) {
      const filePath = String(args.file_path);

      const raw = runOfficecli(`get "${filePath}" / --json`, 60000);
      const result = parseJsonOutput(raw) as Record<string, unknown>;

      const data = (result as { data?: Record<string, unknown> }).data ??
        (result as Record<string, unknown>);

      const format = (data as Record<string, unknown>).format as Record<string, unknown> | undefined;
      const children = (data as Record<string, unknown>).children as Array<Record<string, unknown>> | undefined;

      const outline: Array<{ path: string; preview: string; childCount: number }> = [];
      if (children) {
        for (const child of children) {
          outline.push({
            path: String(child.path ?? ''),
            preview: String(child.preview ?? '').slice(0, 100),
            childCount: Number(child.childCount ?? 0),
          });
        }
      }

      return {
        type: (data as Record<string, unknown>).type,
        childCount: (data as Record<string, unknown>).childCount,
        metadata: format ? {
          title: format.title,
          author: format.author,
          lastModifiedBy: format.lastModifiedBy,
          created: format.created,
          modified: format.modified,
        } : null,
        outline,
      };
    },
  },
];
