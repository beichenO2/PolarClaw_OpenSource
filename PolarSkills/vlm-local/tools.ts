import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

interface IToolHandler {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
}

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function imageToBase64(filePath: string): string {
  return readFileSync(filePath).toString('base64');
}

function imageToBase64Url(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext];
  if (!mime) throw new Error(`不支持的图片格式: ${ext}`);
  return `data:${mime};base64,${imageToBase64(filePath)}`;
}

const PP_BASE = (process.env.POLARPRIVATE_URL || `http://127.0.0.1:${process.env.POLARPRIVATE_PORT || '12790'}`).replace(/\/$/, '');
const LOCAL_VLM = 'L101';

async function callProxyVLM(imageBase64Url: string, query: string): Promise<string> {
  const body = {
    model: LOCAL_VLM,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageBase64Url } },
          { type: 'text', text: query },
        ],
      },
    ],
    max_tokens: 2000,
    temperature: 0.3,
  };

  const res = await fetch(`${PP_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VLM proxy ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    model?: string;
  };
  return data.choices?.[0]?.message?.content ?? '(无输出)';
}

export const tools: IToolHandler[] = [
  {
    name: 'vlm_analyze',
    description: '使用 vision LLM 分析本地图片文件。可用于评估图表质量、审查文档页面、理解图片内容。',
    parameters: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: '本地图片文件路径（PNG/JPG/WebP）' },
        query: { type: 'string', description: '分析问题或评估维度（如"评估图表质量"、"描述图片内容"、"检查公式格式"）' },
      },
      required: ['image_path', 'query'],
    },
    async handler(args) {
      const imagePath = String(args.image_path);
      const query = String(args.query || '请描述这张图片的内容');

      if (!existsSync(imagePath)) {
        throw new Error(`图片文件不存在: ${imagePath}`);
      }

      const base64Url = imageToBase64Url(imagePath);
      const analysis = await callProxyVLM(base64Url, query);
      return { image: imagePath, query, analysis, model: LOCAL_VLM, backend: 'local-proxy' };
    },
  },
];
