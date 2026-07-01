/**
 * Safari browser automation via AppleScript — reuses the user's logged-in Safari session.
 * macOS only. Requires Safari → Settings → Developer → "Allow JavaScript from Apple Events".
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const DEFAULT_TIMEOUT_MS = 60_000;

function assertDarwin(): void {
  if (process.platform !== 'darwin') {
    throw new Error('Safari browser automation requires macOS');
  }
}

function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeJsString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

export interface SafariPageSnapshot {
  url: string;
  title: string;
  text: string;
}

export async function safariRunJs(
  url: string,
  jsCode: string,
  opts?: { delaySec?: number; timeoutMs?: number },
): Promise<string> {
  assertDarwin();
  const delaySec = opts?.delaySec ?? 6;
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS + delaySec * 1000;
  const safeUrl = escapeAppleScriptString(url);
  const safeJs = escapeJsString(jsCode);

  const appleScript = `
tell application "Safari"
  tell window 1
    set current tab to (make new tab with properties {URL:"${safeUrl}"})
  end tell
  delay ${delaySec}
  set res to (do JavaScript "${safeJs}" in current tab of window 1)
  tell window 1
    close current tab
  end tell
  return res
end tell`;

  const { stdout } = await execAsync(
    `osascript << 'APPLESCRIPT_EOF'\n${appleScript}\nAPPLESCRIPT_EOF`,
    { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, shell: '/bin/bash' },
  );
  return stdout.trim();
}

const PAGE_SNAPSHOT_JS = `
JSON.stringify({
  url: location.href,
  title: document.title,
  text: (document.body && document.body.innerText ? document.body.innerText : '').slice(0, 12000)
})
`.trim();

export async function safariSnapshot(url: string): Promise<SafariPageSnapshot> {
  const raw = await safariRunJs(url, PAGE_SNAPSHOT_JS, { delaySec: 8 });
  try {
    return JSON.parse(raw) as SafariPageSnapshot;
  } catch {
    return { url, title: '', text: raw.slice(0, 12000) };
  }
}

export async function safariFillFields(
  url: string,
  fields: Record<string, string>,
): Promise<Array<{ field: string; success: boolean; message?: string }>> {
  const js = `
(function() {
  const fields = ${JSON.stringify(fields)};
  const results = [];
  for (const [desc, value] of Object.entries(fields)) {
    let el = null;
    const labels = Array.from(document.querySelectorAll('label'));
    for (const label of labels) {
      if (label.textContent && label.textContent.includes(desc)) {
        const id = label.getAttribute('for');
        if (id) el = document.getElementById(id);
        if (!el) el = label.querySelector('input, textarea, select');
        break;
      }
    }
    if (!el) {
      el = document.querySelector('input[placeholder*="' + desc + '"], textarea[placeholder*="' + desc + '"], input[name*="' + desc + '"]');
    }
    if (el) {
      el.focus();
      el.value = value;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      results.push({ field: desc, success: true });
    } else {
      results.push({ field: desc, success: false, message: 'element not found' });
    }
  }
  return JSON.stringify(results);
})()
`.trim();

  const raw = await safariRunJs(url, js, { delaySec: 8 });
  try {
    return JSON.parse(raw) as Array<{ field: string; success: boolean; message?: string }>;
  } catch {
    return Object.keys(fields).map((field) => ({
      field,
      success: false,
      message: raw.slice(0, 200),
    }));
  }
}

export async function safariSubmitForm(url: string): Promise<{ success: boolean; message?: string }> {
  const js = `
(function() {
  const btn = document.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
  if (btn) { btn.click(); return JSON.stringify({ success: true }); }
  const form = document.querySelector('form');
  if (form) { form.submit(); return JSON.stringify({ success: true }); }
  return JSON.stringify({ success: false, message: 'no submit control found' });
})()
`.trim();

  const raw = await safariRunJs(url, js, { delaySec: 4 });
  try {
    return JSON.parse(raw) as { success: boolean; message?: string };
  } catch {
    return { success: false, message: raw.slice(0, 200) };
  }
}
