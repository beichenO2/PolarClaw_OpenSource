import { describe, it, expect } from 'vitest';
import {
  isTaociTrigger,
  stripTaociTrigger,
  buildTaociConversationId,
} from './taoci-route.js';

describe('taoci-route', () => {
  it('detects @套辞', () => {
    expect(isTaociTrigger('@套辞 你好')).toBe(true);
    expect(isTaociTrigger('普通消息')).toBe(false);
  });

  it('strips trigger', () => {
    expect(stripTaociTrigger('@套辞 药大')).toBe('药大');
  });

  it('builds stable conversation id', () => {
    const id = buildTaociConversationId('feishu:rr', 'ou_x');
    expect(id).toMatch(/^taoci-/);
  });
});
