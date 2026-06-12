/**
 * Lab Report Generator — PolarClaw Skill
 * Workflow: LLM generates section content → officecli assembles .docx from template.
 */

import { execFile, execSync } from 'node:child_process';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import type { IToolHandler } from '../../src/ports/tools.js';
import { randomUUID } from 'node:crypto';

const execFileAsync = promisify(execFile);

// ─── LLM Proxy ───────────────────────────────────────────────────────────

const PP_URL = process.env.POLARPRIVATE_URL ?? 'http://127.0.0.1:12790';
const LLM_BASE = process.env.POLARCLAW_LLM_BASE_URL ?? `${PP_URL}/v1`;
const LLM_MODEL = process.env.LAB_REPORT_MODEL ?? process.env.POLARCLAW_MODEL_GENERAL ?? 'qwen3.6-plus';
const LLM_TIMEOUT_MS = 120_000;

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

async function callLLM(messages: LLMMessage[], maxTokens = 3000): Promise<string> {
  const url = `${LLM_BASE}/chat/completions`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: LLM_MODEL,
          messages,
          temperature: 0.7,
          max_tokens: maxTokens,
        }),
        signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
      const data = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      let content = data.choices[0].message.content;
      content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
      return content;
    } catch (err) {
      if (attempt < 2) await new Promise((r) => setTimeout(r, 3000));
      else throw err;
    }
  }
  throw new Error('LLM call failed after 3 attempts');
}

// ─── officecli wrapper ─────────────────────────────────────────────────

async function officecli(...args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execFileAsync('~/.local/bin/officecli', args, { timeout: 30_000 });
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? String(err) };
  }
}

// ─── Types ─────────────────────────────────────────────────────────────

interface SectionDef {
  key: string;
  heading: string;
  prompt: string;
  maxTokens?: number;
  fixedContent?: string;
}

interface ImageDef {
  path: string;
  caption?: string;
  width?: string;
}

interface CoverFields {
  studentName: string;
  studentId: string;
  instructor?: string;
  experimentDate?: string;
}

interface GenerateInput {
  experimentContext: string;
  templatePath: string;
  outputPath: string;
  sections: SectionDef[];
  images?: ImageDef[];
  imageAnchorParaId?: string;
  templateMap?: Record<string, unknown>;
  coverFields?: CoverFields;
  cachePath?: string;
}

// ─── Phase 1: LLM Content Generation ────────────────────────────────────

async function generateContent(input: GenerateInput): Promise<Record<string, string>> {
  const systemPrompt = `You are a lab report writing assistant. Generate a complete lab report section based on the experiment context provided.

IMPORTANT RULES:
1. Write in Chinese. Use proper Chinese punctuation (，。：；？！"").
2. Do NOT copy content from any template. Write fresh content based on the experiment context.
3. Template documents are for FORMAT REFERENCE ONLY. Never copy template text.
4. All content must be original and based on the experiment context.
5. Use proper Chinese fonts in Word documents (SimSun/宋体 for body text).`;

  const content: Record<string, string> = {};

  for (const sec of input.sections) {
    if (sec.fixedContent) {
      content[sec.key] = sec.fixedContent;
      continue;
    }

    const messages: LLMMessage[] = [
      { role: 'system', content: systemPrompt },
      {
        role: 'user',
        content: `${input.experimentContext}\n\n${sec.prompt}`,
      },
    ];

    content[sec.key] = await callLLM(messages, sec.maxTokens ?? 3000);
  }

  return content;
}

// ─── Phase 2: Document assembly via officecli ──────────────────────────

async function buildDocument(
  input: GenerateInput,
  content: Record<string, string>,
): Promise<string> {
  const out = resolve(input.outputPath);
  await mkdir(dirname(out), { recursive: true });
  await copyFile(input.templatePath, out);

  await officecli('open', out);

  // Replace cover page placeholder fields using python-docx
  const cover = input.coverFields;
  if (cover) {
    const pythonScript = `
from docx import Document
import sys
doc = Document(sys.argv[1])
replaces = [
  ['学生姓名：', '${cover.studentName ?? ''}'],
  ['学号：', '${cover.studentId ?? ''}'],
  ['指导教师：', '${cover.instructor ?? ''}'],
  ['实验时间：', '${cover.experimentDate ?? ''}'],
]
for para in doc.paragraphs:
    for old, new in replaces:
        if old in para.text:
            para.text = para.text.replace(old, new)
            break
doc.save(sys.argv[1])
print("cover ok")
`;
    try {
      const result = execSync('python3', ['-c', pythonScript, out], { timeout: 30000 });
      const resultStr = Buffer.isBuffer(result) ? result.toString('utf8') : String(result ?? '');
      console.error(`[buildDocument cover] ${resultStr.trim()}`);
    } catch (err) {
      console.error(`[buildDocument cover] error: ${err}`);
    }
  }

  const tmap = input.templateMap ?? {};

  // When no templateMap is provided, use python-docx to auto-replace section content
  if (Object.keys(tmap).length === 0) {
    const sectionList = input.sections.map((s) => ({
      heading: s.heading,
      key: s.key,
      text: content[s.key] ?? '',
    }));

    // Write Python script to temp file to avoid escaping issues
    const scriptPath = join(tmpdir(), `lab_report_${randomUUID()}.py`);
    const pythonScriptContent = `
from docx import Document
from docx.oxml import OxmlElement
import sys

doc = Document(sys.argv[1])

sections = ${JSON.stringify(sectionList)}

def norm(t):
    return t.replace('\\u3000', ' ').replace('：', '').strip()

# Find heading paragraph elements
heading_elements = {}
for para in doc.paragraphs:
    for sec in sections:
        if norm(para.text) == norm(sec['heading']):
            heading_elements[sec['heading']] = para._p

body = doc._element.body

def get_body_elems():
    return list(body)

def find_heading_after(h_elem, all_elems):
    found_self = False
    for elem in all_elems:
        if elem is h_elem:
            found_self = True
            continue
        if found_self and elem.tag.endswith('}p'):
            texts = [node.text for node in elem.iter() if node.tag.endswith('}t') and node.text]
            text = ''.join(texts)
            for sec in sections:
                if norm(text) == norm(sec['heading']):
                    return elem
    return None

for sec in sections:
    h_elem = heading_elements.get(sec['heading'])
    if h_elem is None:
        continue
    new_lines = [l.strip() for l in sec['text'].split('\\n') if l.strip()]

    all_elems = get_body_elems()
    next_elem = find_heading_after(h_elem, all_elems)

    found_self = False
    to_remove = []
    for elem in all_elems:
        if elem is h_elem:
            found_self = True
            continue
        if found_self and elem.tag.endswith('}p'):
            if next_elem is None or elem is not next_elem:
                to_remove.append(elem)
            else:
                break

    for elem in to_remove:
        elem.getparent().remove(elem)

    insert_after = h_elem
    for line in new_lines:
        new_p = OxmlElement('w:p')
        new_r = OxmlElement('w:r')
        new_t = OxmlElement('w:t')
        new_t.text = line
        new_r.append(new_t)
        new_p.append(new_r)
        insert_after.addnext(new_p)
        insert_after = new_p

doc.save(sys.argv[1])
print("ok")
`;

    await writeFile(scriptPath, pythonScriptContent, 'utf8');

    try {
      const result = execSync('python3', [scriptPath, out], { timeout: 30000 });
      const resultStr = Buffer.isBuffer(result) ? result.toString('utf8') : String(result ?? '');
      console.error(`[buildDocument auto-replace] ${resultStr.trim()}`);
    } catch (err) {
      console.error(`[buildDocument auto-replace] error: ${err}`);
    } finally {
      try { await writeFile(scriptPath, '', 'utf8'); } catch (_) {}
    }
  } else {
    // Original templateMap-based content insertion
    for (const sec of input.sections) {
      const text = content[sec.key];
      if (!text) continue;
      const mapping = tmap[sec.key] as { headingParaId?: string; removeParaIds?: string[] } | undefined;
      if (!mapping) continue;
      for (const pid of (mapping.removeParaIds ?? [])) {
        for (let i = 0; i < 5; i++) {
          const { stdout } = await officecli('remove', out, `/body/p[@paraId=${pid}]`);
          if (stdout.toLowerCase().includes('not found') || stdout.toLowerCase().includes('no element')) break;
        }
      }
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
      for (const line of [...lines].reverse()) {
        const res = await officecli(
          'add', out, '/body', '--type', 'paragraph',
          '--prop', `text=${line}`,
          '--after', `/body/p[@paraId=${mapping.headingParaId}]`,
        );
        if (res.stderr) console.error(`[officecli error] ${res.stderr}`);
      }
    }
  }

  // Phase 2b: Apply uniform Word styles to all paragraphs
  {
    const styleScript = `
from docx import Document
from docx.oxml import OxmlElement
import sys

doc = Document(sys.argv[1])

def set_line_spacing(p, spacing=360):
    pPr = p._p.get_or_add_pPr()
    for sp in pPr.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}spacing'):
        pPr.remove(sp)

def set_paragraph_spacing(p, before=0, after=80):
    pPr = p._p.get_or_add_pPr()
    for sp in pPr.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}spacing'):
        sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}before', str(before))
        sp.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}after', str(after))

def set_font(run, name='SimSun', size=11):
    rPr = run._r.get_or_add_rPr()
    for rFonts in rPr.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rFonts'):
        rPr.remove(rFonts)
    from docx.oxml import OxmlElement
    rFonts = OxmlElement('w:rFonts')
    rFonts.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}eastAsia', name)
    rFonts.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}ascii', name)
    rFonts.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}hAnsi', name)
    rPr.append(rFonts)
    for sz in rPr.findall('.//{http://schemas.openxmlformats.org/wordprocessingml/2006/main}sz'):
        sz.set('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val', str(size * 2))

for p in doc.paragraphs:
    if not p.text.strip():
        continue
    set_line_spacing(p, 360)
    set_paragraph_spacing(p, before=0, after=80)
    for run in p.runs:
        set_font(run, 'SimSun', 11)

doc.save(sys.argv[1])
print("styles applied")
`;
    try {
      const result = execSync('python3', ['-c', styleScript, out], { timeout: 30000 });
      const resultStr = Buffer.isBuffer(result) ? result.toString('utf8') : String(result ?? '');
      console.error(`[buildDocument style] ${resultStr.trim()}`);
    } catch (err) {
      console.error(`[buildDocument style] error: ${err}`);
    }
  }

  // Insert images
  if (input.images?.length) {
    const anchor = input.imageAnchorParaId
      ? `/body/p[@paraId=${input.imageAnchorParaId}]`
      : undefined;

    for (const img of input.images) {
      const imgArgs = [
        'add', out, '/body', '--type', 'image',
        '--prop', `src=${img.path}`,
        '--prop', `width=${img.width ?? '13cm'}`,
      ];
      if (anchor) imgArgs.push('--before', anchor);
      await officecli(...imgArgs);

      const capArgs = [
        'add', out, '/body', '--type', 'paragraph',
        '--prop', `text=${img.caption}`,
      ];
      if (anchor) capArgs.push('--before', anchor);
      await officecli(...capArgs);
    }
  }

  await officecli('close', out);
  return out;
}

// ─── Phase 3: Validation ───────────────────────────────────────────────

async function validateDocument(docPath: string): Promise<{
  stats: string;
  outline: string;
  warnings: string;
}> {
  const [stats, outline, validation] = await Promise.all([
    officecli('view', docPath, 'stats'),
    officecli('view', docPath, 'outline'),
    officecli('validate', docPath),
  ]);
  return {
    stats: stats.stdout,
    outline: outline.stdout,
    warnings: validation.stderr.trim(),
  };
}

// ─── Tool: lab_report_generate ─────────────────────────────────────────

export const labReportGenerate: IToolHandler = {
  name: 'lab_report_generate',
  description:
    '完整实验报告生成工作流：LLM 生成各章节内容 → officecli 组装 .docx 文档 → 插入实验图片 → 验证。' +
    '需提供实验背景、模板路径、章节定义、图片列表等。',
  parameters: {
    type: 'object',
    properties: {
      experiment_context: {
        type: 'string',
        description: '实验背景和上下文信息（从PPT等来源提取）',
      },
      template_path: {
        type: 'string',
        description: 'Word 模板文件路径',
      },
      output_path: {
        type: 'string',
        description: '输出 .docx 文件路径（不含扩展名）',
      },
      sections: {
        type: 'array',
        description: '章节定义列表',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: '章节唯一标识' },
            heading: { type: 'string', description: '章节标题（如"四、实验原理"）' },
            prompt: { type: 'string', description: 'LLM 生成该章节内容的提示词' },
            max_tokens: { type: 'number', description: '最大 token 数' },
            fixed_content: { type: 'string', description: '（可选）固定内容，跳过 LLM' },
          },
          required: ['key', 'heading', 'prompt'],
        },
      },
      images: {
        type: 'array',
        description: '（可选）要插入的图片列表',
        items: {
          type: 'object',
          properties: {
            path: { type: 'string' },
            caption: { type: 'string' },
            width: { type: 'string' },
          },
          required: ['path'],
        },
      },
      image_anchor_para_id: { type: 'string' },
      template_map: { type: 'object' },
      cover_fields: {
        type: 'object',
        description: '封面信息',
        properties: {
          student_name: { type: 'string' },
          student_id: { type: 'string' },
          instructor: { type: 'string' },
          experiment_date: { type: 'string' },
        },
      },
      cache_path: { type: 'string' },
    },
    required: ['experiment_context', 'template_path', 'output_path', 'sections'],
  },
  async handler(args: Record<string, unknown>) {
    const input: GenerateInput = {
      experimentContext: String(args.experiment_context ?? ''),
      templatePath: String(args.template_path),
      outputPath: String(args.output_path),
      sections: ((args.sections as SectionDef[]) ?? []).map((s) => ({
        key: String(s.key),
        heading: String(s.heading),
        prompt: String(s.prompt),
        maxTokens: s.maxTokens ? Number(s.maxTokens) : undefined,
        fixedContent: s.fixedContent ? String(s.fixedContent) : undefined,
      })),
      images: (args.images as ImageDef[])?.map((img) => ({
        path: String(img.path),
        caption: img.caption ? String(img.caption) : undefined,
        width: img.width ? String(img.width) : undefined,
      })),
      imageAnchorParaId: args.image_anchor_para_id ? String(args.image_anchor_para_id) : undefined,
      templateMap: args.template_map as Record<string, unknown> | undefined,
      coverFields: args.cover_fields ? {
        studentName: String((args.cover_fields as Record<string, string>)['student_name'] ?? ''),
        studentId: String((args.cover_fields as Record<string, string>)['student_id'] ?? ''),
        instructor: String((args.cover_fields as Record<string, string>)['instructor'] ?? ''),
        experimentDate: String((args.cover_fields as Record<string, string>)['experiment_date'] ?? ''),
      } : undefined,
      cachePath: args.cache_path ? String(args.cache_path) : undefined,
    };

    // Check cache
    const cachePath = args.cache_path ? String(args.cache_path) : undefined;
    if (cachePath) {
      try {
        const cached = await readFile(cachePath, 'utf8');
        const parsed = JSON.parse(cached) as Record<string, string>;
        if (Object.keys(parsed).length > 0) {
          const out = await buildDocument(input, parsed);
          const validation = await validateDocument(out);
          return { output_path: out, cached: true, validation };
        }
      } catch (_) {}
    }

    const content = await generateContent(input);

    if (cachePath) {
      await writeFile(cachePath, JSON.stringify(content), 'utf8').catch(() => {});
    }

    const out = await buildDocument(input, content);
    const validation = await validateDocument(out);

    return {
      success: true,
      output_path: out,
      sections_generated: Object.keys(content).length,
      section_lengths: Object.fromEntries(
        Object.entries(content).map(([k, v]) => [k, v.length]),
      ),
      validation,
    };
  },
};

// ─── Tool: lab_report_preview ──────────────────────────────────────────

export const labReportPreview: IToolHandler = {
  name: 'lab_report_preview',
  description:
    '仅运行 LLM 内容生成（不构建文档），返回各章节文本。用于预览和调整后再正式构建。',
  parameters: {
    type: 'object',
    properties: {
      experiment_context: { type: 'string' },
      sections: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' },
            heading: { type: 'string' },
            prompt: { type: 'string' },
            max_tokens: { type: 'number' },
          },
          required: ['key', 'heading', 'prompt'],
        },
      },
    },
    required: ['experiment_context', 'sections'],
  },
  async handler(args: Record<string, unknown>) {
    const input: GenerateInput = {
      experimentContext: String(args.experiment_context ?? ''),
      templatePath: '',
      outputPath: '',
      sections: ((args.sections as SectionDef[]) ?? []).map((s) => ({
        key: String(s.key),
        heading: String(s.heading),
        prompt: String(s.prompt),
        maxTokens: s.maxTokens ? Number(s.maxTokens) : undefined,
      })),
    };
    const content = await generateContent(input);
    return { sections: content };
  },
};

// ─── Tool: lab_report_health ──────────────────────────────────────────

export const labReportHealth: IToolHandler = {
  name: 'lab_report_health',
  description: '检查 lab-report 生成环境是否正常（officecli、python-docx 等）',
  parameters: { type: 'object', properties: {} },
  async handler() {
    const checks = await Promise.all([
      execFileAsync('python3', ['-c', 'from docx import Document; print("ok")']).then(() => 'python-docx: ok').catch(() => 'python-docx: MISSING'),
      execFileAsync('~/.local/bin/officecli', ['--version']).then(() => 'officecli: ok').catch(() => 'officecli: MISSING'),
    ]);
    return { checks };
  },
};

// ─── Exports ────────────────────────────────────────────────────────────

export const labReportTools: IToolHandler[] = [
  labReportGenerate,
  labReportPreview,
  labReportHealth,
];
