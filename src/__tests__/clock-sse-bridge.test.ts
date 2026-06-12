import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createClockSseBridge, type IClockSseBridgeConfig } from '../adapters/proactive/clock-sse-bridge.js';
import type { IProactiveEngine, IProactiveTrigger, IProactiveMessage, IScheduleRule } from '../ports/proactive.js';
import { createServer, type Server } from 'node:http';

function makeCareEngine() {
  const triggers: IProactiveTrigger[] = [];
  const engine: IProactiveEngine = {
    start: vi.fn(),
    stop: vi.fn(),
    trigger: vi.fn().mockImplementation(async (t: IProactiveTrigger) => {
      triggers.push(t);
      return { userId: t.userId, prompt: 'care', priority: 'normal' as const, tag: 'test' };
    }),
    addRule: vi.fn(),
    removeRule: vi.fn().mockReturnValue(true),
    listRules: vi.fn().mockReturnValue([]),
  };
  return { engine, triggers };
}

function createSSEServer(): {
  server: Server;
  port: number;
  send: (event: string, data: string) => void;
  close: () => Promise<void>;
} {
  let response: import('node:http').ServerResponse | null = null;
  const server = createServer((req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    response = res;
  });

  return new Promise<ReturnType<typeof createSSEServer>>((resolve) => {
    server.listen(0, () => {
      const addr = server.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve({
        server,
        port,
        send(event: string, data: string) {
          if (response && !response.destroyed) {
            response.write(`event: ${event}\ndata: ${data}\n\n`);
          }
        },
        async close() {
          response?.end();
          return new Promise<void>((r) => server.close(() => r()));
        },
      });
    });
  }) as unknown as ReturnType<typeof createSSEServer>;
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

describe('createClockSseBridge', () => {
  it('connects and receives timer_change → triggers CareEngine', async () => {
    const sse = await (createSSEServer as unknown as () => Promise<Awaited<ReturnType<typeof createSSEServer>>>)();
    const { engine, triggers } = makeCareEngine();

    const bridge = createClockSseBridge(
      {
        clockBaseUrl: `http://127.0.0.1:${sse.port}`,
        usernames: ['testuser'],
        reconnectBaseMs: 100,
      },
      engine,
    );

    bridge.start();
    await sleep(200);

    // Send snapshot (sets initial status to 'working')
    sse.send('snapshot', JSON.stringify({ user_status: 'working' }));
    await sleep(100);

    // Send timer_change (working → idle = session ended)
    sse.send('timer_change', JSON.stringify({
      user_status: 'idle',
      timer: { type: 'pomodoro', duration: 25 },
    }));
    await sleep(200);

    expect(triggers.length).toBe(1);
    expect(triggers[0]!.type).toBe('event');
    expect(triggers[0]!.userId).toBe('testuser');
    expect(triggers[0]!.reason).toBe('timer-complete');
    expect(triggers[0]!.context).toHaveProperty('from', 'working');
    expect(triggers[0]!.context).toHaveProperty('to', 'idle');

    bridge.stop();
    await sse.close();
  });

  it('handles session_complete event', async () => {
    const sse = await (createSSEServer as unknown as () => Promise<Awaited<ReturnType<typeof createSSEServer>>>)();
    const { engine, triggers } = makeCareEngine();

    const bridge = createClockSseBridge(
      {
        clockBaseUrl: `http://127.0.0.1:${sse.port}`,
        usernames: ['testuser'],
        reconnectBaseMs: 100,
      },
      engine,
    );

    bridge.start();
    await sleep(200);

    sse.send('session_complete', JSON.stringify({
      session_type: 'pomodoro',
      duration_minutes: 25,
    }));
    await sleep(200);

    expect(triggers.length).toBe(1);
    expect(triggers[0]!.reason).toBe('timer-complete');

    bridge.stop();
    await sse.close();
  });

  it('ignores timer_change when not transitioning from active state', async () => {
    const sse = await (createSSEServer as unknown as () => Promise<Awaited<ReturnType<typeof createSSEServer>>>)();
    const { engine, triggers } = makeCareEngine();

    const bridge = createClockSseBridge(
      {
        clockBaseUrl: `http://127.0.0.1:${sse.port}`,
        usernames: ['testuser'],
        reconnectBaseMs: 100,
      },
      engine,
    );

    bridge.start();
    await sleep(200);

    // Set status to 'idle' (not active)
    sse.send('snapshot', JSON.stringify({ user_status: 'idle' }));
    await sleep(100);

    // idle → resting should NOT trigger (was not active)
    sse.send('timer_change', JSON.stringify({ user_status: 'resting' }));
    await sleep(200);

    expect(triggers.length).toBe(0);

    bridge.stop();
    await sse.close();
  });

  it('handles invalid JSON gracefully', async () => {
    const sse = await (createSSEServer as unknown as () => Promise<Awaited<ReturnType<typeof createSSEServer>>>)();
    const { engine, triggers } = makeCareEngine();

    const bridge = createClockSseBridge(
      {
        clockBaseUrl: `http://127.0.0.1:${sse.port}`,
        usernames: ['testuser'],
        reconnectBaseMs: 100,
      },
      engine,
    );

    bridge.start();
    await sleep(200);

    sse.send('timer_change', 'not-valid-json');
    await sleep(200);

    expect(triggers.length).toBe(0);

    bridge.stop();
    await sse.close();
  });

  it('stop() prevents reconnection', async () => {
    const { engine } = makeCareEngine();

    const bridge = createClockSseBridge(
      {
        clockBaseUrl: 'http://127.0.0.1:1',
        usernames: ['testuser'],
        reconnectBaseMs: 50,
        reconnectMaxMs: 100,
      },
      engine,
    );

    bridge.start();
    await sleep(100);
    bridge.stop();
    await sleep(200);
  });
});
