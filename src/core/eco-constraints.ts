/**
 * 生态约束加载器 — 从 Agent_core 协议提取精简约束
 *
 * 每条约束控制在 1-2 句话，总 token 开销 ~400 tokens。
 * 按任务类型选择性加载相关协议的核心规则。
 */

import type { Constraint } from './task-contract.js';

interface EcoRule {
  id: string;
  protocol: string;
  text: string;
  category: Constraint['category'];
  /** 触发条件：用户消息中包含这些关键词时才注入 */
  triggers: string[];
}

/**
 * 精简的生态约束表。
 * 每条从 Agent_core/protocols/PROTOCOLS.md 对应协议中提炼为 1-2 句核心规则。
 */
const ECO_RULES: EcoRule[] = [
  // Protocol C: Commit 流程
  {
    id: 'eco-c1',
    protocol: 'C',
    text: 'commit 必须在 agent/{AGENT_ID}/{task} 分支上，禁止直接 commit 到 main。每个 commit 对应一个最小完整改动。',
    category: 'process',
    triggers: ['commit', 'git', 'push', '提交', '上传', 'github', 'sync', '同步'],
  },
  // Protocol L: PolarSoul 维护
  {
    id: 'eco-l1',
    protocol: 'L',
    text: 'commit 涉及某个目录时，刷新根 PolarSoul.md 目录地图中对应行的"最后更新"日期。只记录影响系统身份或方向的重大改动。',
    category: 'process',
    triggers: ['polarsoul', '文档', 'commit', '提交', '架构', '设计'],
  },
  // Protocol M: 任务书
  {
    id: 'eco-m1',
    protocol: 'M',
    text: '所有任务通过"规划→编译→执行"三层流程。任务书是执行记录层，禁止删除已归档的任务书。',
    category: 'process',
    triggers: ['任务书', '规划', '编译', '执行', '任务', 'task'],
  },
  // Protocol N1: LLM 调用
  {
    id: 'eco-n1',
    protocol: 'N1',
    text: '调用 LLM 只传 capability code，不传模型名、Base URL 或 API Key。使用 createLLMClient() SDK。',
    category: 'tool',
    triggers: ['llm', '模型', 'api', '调用', 'sdk'],
  },
  // Protocol N2: 端口分配
  {
    id: 'eco-n2',
    protocol: 'N2',
    text: '所有服务端口必须通过 PolarPort 统一分配，严禁硬编码端口号。',
    category: 'process',
    triggers: ['端口', 'port', '服务', 'server', '启动'],
  },
  // Protocol N3: 进程管理
  {
    id: 'eco-n3',
    protocol: 'N3',
    text: '所有服务启动/重启必须通过 SOTAgent (sotctl)，禁止手动 kill 或 nohup。',
    category: 'process',
    triggers: ['启动', '重启', 'restart', 'start', '进程', 'daemon', 'sotctl'],
  },
  // P21: SSoT 同步
  {
    id: 'eco-p21',
    protocol: 'P21',
    text: '每次有效工作后同步 polaris.json (SSoT)，确保 code 与文档一致。',
    category: 'process',
    triggers: ['ssot', 'polaris', '同步', '需求', 'feature', '文档'],
  },
  // P13: 删除安全
  {
    id: 'eco-p13',
    protocol: 'P13',
    text: '删除文件/目录前必须确认影响范围，禁止递归删除项目根目录或 git 历史。',
    category: 'process',
    triggers: ['删除', 'delete', 'remove', 'rm', '清理', 'clean'],
  },
];

/**
 * 基于用户消息内容，选择性加载相关的生态约束。
 * 匹配规则：用户消息包含任一 trigger 关键词时，加载该约束。
 */
export function loadEcoConstraints(userMessage: string): Constraint[] {
  const msgLower = userMessage.toLowerCase();
  const matched: Constraint[] = [];

  for (const rule of ECO_RULES) {
    const shouldLoad = rule.triggers.some(t => msgLower.includes(t.toLowerCase()));
    if (shouldLoad) {
      matched.push({
        id: rule.id,
        source: 'ecosystem',
        text: `[${rule.protocol}] ${rule.text}`,
        category: rule.category,
        verifiable: false,
      });
    }
  }

  return matched;
}

/**
 * 加载所有生态约束（不做关键词过滤）。
 * 用于需要完整约束覆盖的场景（如 YOLO 模式）。
 */
export function loadAllEcoConstraints(): Constraint[] {
  return ECO_RULES.map(rule => ({
    id: rule.id,
    source: 'ecosystem' as const,
    text: `[${rule.protocol}] ${rule.text}`,
    category: rule.category,
    verifiable: false,
  }));
}
