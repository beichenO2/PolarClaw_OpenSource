import { readFileSync, existsSync } from 'node:fs';
import { extname } from 'node:path';

const MIME_MAP = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

function imageToBase64(filePath) {
  return readFileSync(filePath).toString('base64');
}

function imageToBase64Url(filePath) {
  const ext = extname(filePath).toLowerCase();
  const mime = MIME_MAP[ext];
  if (!mime) throw new Error(`Unsupported image format: ${ext}`);
  return `data:${mime};base64,${imageToBase64(filePath)}`;
}

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_VLM_MODEL = process.env.OLLAMA_VLM_MODEL || 'qwen3-vl:8b';

async function isOllamaVLMAvailable() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return (data.models || []).some(m => m.name.includes('vl'));
  } catch {
    return false;
  }
}

async function callOllamaVLM(imagePath, query) {
  const base64 = imageToBase64(imagePath);
  const body = {
    model: OLLAMA_VLM_MODEL,
    messages: [{ role: 'user', content: query, images: [base64] }],
    stream: false,
  };

  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Ollama VLM ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.message?.content ?? '(no output)';
}

async function callOpenAIVLM(imageBase64Url, query, baseUrl, apiKey, model) {
  const body = {
    model,
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

  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`VLM API ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? '(no output)';
}

export const tools = [
  {
    name: 'vlm_analyze',
    description: '使用 vision LLM 分析本地图片文件。优先使用本地 Ollama VLM (qwen3-vl)，不可用时 fallback 到 PolarPrivate proxy。',
    parameters: {
      type: 'object',
      properties: {
        image_path: { type: 'string', description: '本地图片文件路径（PNG/JPG/WebP）' },
        query: { type: 'string', description: '分析问题（如"评估图表质量"、"描述图片内容"、"识别文字"）' },
      },
      required: ['image_path', 'query'],
    },
    async handler(args) {
      const imagePath = String(args.image_path);
      const query = String(args.query || '请描述这张图片的内容');

      if (!existsSync(imagePath)) {
        throw new Error(`File not found: ${imagePath}`);
      }

      const ollamaOk = await isOllamaVLMAvailable();
      if (ollamaOk) {
        const analysis = await callOllamaVLM(imagePath, query);
        return { image: imagePath, query, analysis, model: OLLAMA_VLM_MODEL, backend: 'ollama-local' };
      }

      const base64Url = imageToBase64Url(imagePath);
      const baseUrl = process.env.POLARCLAW_LLM_BASE_URL
        || (process.env.POLARPRIVATE_URL || 'http://127.0.0.1:12790');
      const apiKey = process.env.POLARCLAW_LLM_API_KEY
        || process.env.DASHSCOPE_API_KEY
        || 'proxy-managed';
      const model = process.env.POLARCLAW_MODEL_VISION || 'qwen-vl-max';

      const analysis = await callOpenAIVLM(base64Url, query, baseUrl, apiKey, model);
      return { image: imagePath, query, analysis, model, backend: 'polarprivate-proxy' };
    },
  },
];
