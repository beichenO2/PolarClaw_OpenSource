/**
 * PII 检测器 — 正则检测中国常见 PII
 *
 * 从旧版移植并 TypeScript 化。
 * 每个检测到的实体替换为编号占位符，维护双向映射。
 */

export interface IPiiEntity {
  type: string;
  original: string;
  placeholder: string;
}

export type PiiVault = Map<string, string>;

const PII_PATTERNS: Array<{ type: string; regex: RegExp }> = [
  { type: 'PHONE', regex: /(?<!\d)1[3-9]\d{9}(?!\d)/g },
  { type: 'ID_CARD', regex: /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g },
  { type: 'EMAIL', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g },
  { type: 'BANK_CARD', regex: /(?<!\d)\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}(?:\d{0,3})?(?!\d)/g },
  { type: 'IP_ADDR', regex: /(?<!\d)(?:(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d{1,2})(?!\d)/g },
];

/** 正则检测 + 替换 PII */
export function sanitizePii(text: string, existingVault?: PiiVault): {
  sanitized: string;
  entities: IPiiEntity[];
  vault: PiiVault;
} {
  const vault: PiiVault = existingVault ?? new Map();
  const counters = new Map<string, number>();
  const entities: IPiiEntity[] = [];

  const reverseVault = new Map<string, string>();
  for (const [placeholder, original] of vault) {
    reverseVault.set(original, placeholder);
  }

  let sanitized = text;

  for (const { type, regex } of PII_PATTERNS) {
    regex.lastIndex = 0;
    sanitized = sanitized.replace(regex, (match) => {
      if (reverseVault.has(match)) return reverseVault.get(match)!;

      const count = (counters.get(type) ?? 0) + vault.size + 1;
      counters.set(type, (counters.get(type) ?? 0) + 1);
      const placeholder = `$${type}_${count}`;
      vault.set(placeholder, match);
      reverseVault.set(match, placeholder);
      entities.push({ type, original: match, placeholder });
      return placeholder;
    });
  }

  return { sanitized, entities, vault };
}

/** 用自定义实体（PolarPrivate 的 Identity）替换 + 正则兜底 */
export function sanitizeWithCustomEntities(
  text: string,
  customEntities: Array<{ value: string; type?: string }>,
  existingVault?: PiiVault,
): { sanitized: string; entities: IPiiEntity[]; vault: PiiVault } {
  const vault: PiiVault = existingVault ?? new Map();
  const entities: IPiiEntity[] = [];
  let sanitized = text;

  for (const ce of customEntities) {
    const type = ce.type ?? 'NAME';
    if (!ce.value?.trim()) continue;

    let existingPlaceholder: string | null = null;
    for (const [p, o] of vault) {
      if (o === ce.value) { existingPlaceholder = p; break; }
    }

    if (!existingPlaceholder) {
      let n = 1;
      while (vault.has(`$${type}_${n}`)) n++;
      existingPlaceholder = `$${type}_${n}`;
      vault.set(existingPlaceholder, ce.value);
      entities.push({ type, original: ce.value, placeholder: existingPlaceholder });
    }

    sanitized = sanitized.split(ce.value).join(existingPlaceholder);
  }

  const regexResult = sanitizePii(sanitized, vault);
  return {
    sanitized: regexResult.sanitized,
    entities: [...entities, ...regexResult.entities],
    vault: regexResult.vault,
  };
}

/** 将占位符还原为原始值 */
export function desanitize(text: string, vault: PiiVault): string {
  let result = text;
  for (const [placeholder, original] of vault) {
    result = result.split(placeholder).join(original);
  }
  return result;
}

/** 快速检查文本是否含 PII */
export function containsPii(text: string): boolean {
  for (const { regex } of PII_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(text)) return true;
  }
  return false;
}
