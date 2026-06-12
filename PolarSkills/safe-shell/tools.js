// skills/safe-shell/tools.ts
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { homedir } from "node:os";
var POLARISOR_ROOT = resolve(homedir(), "Polarisor");
var MAX_OUTPUT = 50 * 1024;
var BLOCKED_PATTERNS = [
  /\brm\s+-rf\s+\//,
  /\bsudo\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  />\s*\/dev\//,
  /\bshutdown\b/,
  /\breboot\b/
];
function validateCommand(cmd) {
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      throw new Error(`\u547D\u4EE4\u88AB\u5B89\u5168\u7B56\u7565\u963B\u6B62: ${cmd.slice(0, 80)}`);
    }
  }
}
function validateWorkDir(dir) {
  const resolved = resolve(dir);
  if (!resolved.startsWith(POLARISOR_ROOT) && !resolved.startsWith("/tmp/")) {
    throw new Error(`\u5DE5\u4F5C\u76EE\u5F55\u5FC5\u987B\u5728 ~/Polarisor/ \u6216 /tmp/ \u4E0B: ${resolved}`);
  }
  if (!existsSync(resolved)) {
    throw new Error(`\u5DE5\u4F5C\u76EE\u5F55\u4E0D\u5B58\u5728: ${resolved}`);
  }
  return resolved;
}
var tools = [
  {
    name: "shell_exec",
    description: "\u5728\u6307\u5B9A\u76EE\u5F55\u4E0B\u6267\u884C\u4E00\u6761 shell \u547D\u4EE4\u3002\u9002\u7528\u4E8E\u8C03\u7528 MATLAB\u3001Python\u3001ffmpeg \u7B49 CLI \u5DE5\u5177\u5904\u7406\u6570\u636E\u3002\u5DE5\u4F5C\u76EE\u5F55\u9650\u5236\u5728 ~/Polarisor/ \u8303\u56F4\u5185\u3002",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "\u8981\u6267\u884C\u7684 shell \u547D\u4EE4" },
        cwd: { type: "string", description: "\u5DE5\u4F5C\u76EE\u5F55\uFF08\u5FC5\u987B\u5728 ~/Polarisor/ \u4E0B\uFF0C\u9ED8\u8BA4 ~/Polarisor\uFF09" },
        timeout_seconds: { type: "number", description: "\u8D85\u65F6\u79D2\u6570\uFF08\u9ED8\u8BA4 120\uFF09" }
      },
      required: ["command"]
    },
    async handler(args) {
      const command = String(args.command);
      const cwd = validateWorkDir(String(args.cwd || POLARISOR_ROOT));
      const timeoutMs = Math.min(
        (Number(args.timeout_seconds) || 120) * 1e3,
        6e5
      );
      validateCommand(command);
      const start = Date.now();
      let stdout = "";
      let stderr = "";
      let exitCode = 0;
      try {
        stdout = execSync(command, {
          cwd,
          encoding: "utf8",
          timeout: timeoutMs,
          maxBuffer: MAX_OUTPUT,
          env: { ...process.env, HOME: homedir() },
          shell: "/bin/bash"
        });
      } catch (err) {
        const execErr = err;
        exitCode = execErr.status ?? 1;
        stdout = execErr.stdout ?? "";
        stderr = execErr.stderr ?? execErr.message ?? String(err);
      }
      const elapsed = Date.now() - start;
      if (stdout.length > MAX_OUTPUT) {
        stdout = stdout.slice(0, MAX_OUTPUT) + "\n...(\u8F93\u51FA\u5DF2\u622A\u65AD)";
      }
      if (stderr.length > MAX_OUTPUT) {
        stderr = stderr.slice(0, MAX_OUTPUT) + "\n...(\u8F93\u51FA\u5DF2\u622A\u65AD)";
      }
      return {
        exitCode,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        elapsedMs: elapsed,
        cwd
      };
    }
  }
];
export {
  tools
};
