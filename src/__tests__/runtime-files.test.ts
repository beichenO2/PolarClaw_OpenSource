import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..', '..');

describe('runtime governance files', () => {
  it('defines an executable canonical foreground launcher', () => {
    const file = path.join(ROOT, 'Start', 'start.sh');
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.statSync(file).mode & 0o111).not.toBe(0);
    const source = fs.readFileSync(file, 'utf8');
    expect(source).toContain('claim_port "polarclaw" "PolarClaw" 3910');
    expect(source).toContain('POLAR_RUNTIME_MANAGED=1');
    expect(source).toContain('better-sqlite3');
    expect(source).toContain('exec "$NODE_BIN" dist/main.js');
    expect(source).not.toMatch(/(^|\s)(nohup|disown|pkill|killall|kill|lsof)(\s|$)|PID_FILE|setsid|[^&]&\s*$/m);
  });

  it('registers three phases without lifecycle actions', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', 'register-runtime.sh'), 'utf8');
    expect(source).toContain('MODE=${1:-prepare}');
    expect(source).toContain('prepare|cutover|finalize');
    expect(source).toContain('node dist/main.js');
    expect(source).toContain('bash Start/start.sh');
    expect(source).toContain('http://127.0.0.1:3910/api/status');
    expect(source).toContain('id: "polarclaw"');
    expect(source).not.toMatch(/api\/services\/[^"']+\/(start|stop|restart)/);
  });

  it('keeps the legacy daemon entry as an exact PolarProcess client', () => {
    const source = fs.readFileSync(path.join(ROOT, 'scripts', 'run-web-daemon.sh'), 'utf8');
    expect(source).toContain('/api/services/polarclaw/start');
    expect(source).not.toMatch(/dist\/main\.js|npm.*build|launchctl|nohup|PID_FILE/);
  });

  it('declares canonical service management and R9 SSoT', () => {
    const polaris = JSON.parse(fs.readFileSync(path.join(ROOT, 'polaris.json'), 'utf8'));
    const runtime = polaris.requirements.find((item: { id: string }) => item.id === 'R9');
    expect(runtime).toMatchObject({ feature: 'runtime_governance' });
    expect(['in-progress', 'tested', 'done']).toContain(runtime.status);
    expect(polaris.service_management).toMatchObject({
      service_id: 'polarclaw',
      start_command: 'bash Start/start.sh',
      health_endpoint: 'http://127.0.0.1:3910/api/status',
      preferred_port: 3910,
      auto_start: true,
      process_mode: 'foreground_command',
    });

    const soul = fs.readFileSync(path.join(ROOT, 'PolarSoul.md'), 'utf8');
    expect(soul).toContain('PolarProcess');
    expect(soul).not.toContain('launchd: `com.polarclaw.web`');
  });
});
