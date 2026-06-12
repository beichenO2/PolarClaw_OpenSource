export type BlockType = 'entity' | 'preference' | 'fact' | 'goal' | 'relationship' | 'event' | 'concept' | 'procedure' | 'emotion' | 'decision' | 'skill' | 'context' | 'meta';
export type BlockSource = 'conversation' | 'wiki' | 'agent_written' | 'user_explicit';

export interface Block {
  label: string;
  value: string;
  tokens: number;
  read_only: boolean;
  source_wiki: string;
  created_at: string;
  updated_at: string;
  // NEW fields (optional for backward compatibility)
  type?: BlockType;
  temporal?: {
    valid_from?: string;
    valid_until?: string;
    recurrence?: string;
  };
  confidence?: number; // 0.0~1.0
  source?: BlockSource;
  entity_refs?: string[];
}

export interface BlockSearchResult {
  blocks: Block[];
  total: number;
  query: string;
}

export interface Conflict {
  blockA: string; // block label or id
  blockB: string;
  conflict_type: 'contradiction' | 'staleness' | 'ambiguity';
  confidence: number; // 0.0~1.0
}

export interface BlockSearchOptions {
  query?: string;
  user?: string;
  topic?: string;
  top_k?: number;
  types?: BlockType[];
  temporal_valid?: boolean;
}

export interface WikiFrontmatter {
  id?: string;
  title?: string;
  type?: string;
  node_type?: string;
  summary?: string;
  status?: string;
  confidence?: number;
  tags?: string[];
  source_ids?: string[];
  parent_ids?: string[];
  parent_concept?: string | null;
  related_ids?: string[];
  created?: string;
  updated?: string;
  [key: string]: unknown;
}
