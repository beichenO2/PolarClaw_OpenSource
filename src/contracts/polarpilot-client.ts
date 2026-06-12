/**
 * PolarPilotClient — HTTP client for PolarPilot contract endpoints
 *
 * Thin wrapper used by SDK modules to delegate pilot operations
 * to PolarPilot's HTTP API instead of local stores.
 */

export interface PolarPilotClientConfig {
  baseUrl: string;
  timeoutMs?: number;
}

export class PolarPilotClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(config: PolarPilotClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (query) {
      for (const [k, v] of Object.entries(query)) {
        if (v !== undefined && v !== null) {
          url.searchParams.set(k, String(v));
        }
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new PolarPilotError(`PolarPilot returned ${res.status}: ${body}`, res.status);
      }

      return await res.json() as T;
    } catch (err) {
      if (err instanceof PolarPilotError) throw err;
      throw new PolarPilotError(
        `PolarPilot request failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    try {
      const res = await fetch(url.toString(), {
        method: 'POST',
        headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new PolarPilotError(`PolarPilot returned ${res.status}: ${text}`, res.status);
      }

      return await res.json() as T;
    } catch (err) {
      if (err instanceof PolarPilotError) throw err;
      throw new PolarPilotError(
        `PolarPilot request failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const url = new URL(path, this.baseUrl);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await fetch(url.toString(), {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new PolarPilotError(`PolarPilot returned ${res.status}: ${text}`, res.status);
      }

      return await res.json() as T;
    } catch (err) {
      if (err instanceof PolarPilotError) throw err;
      throw new PolarPilotError(
        `PolarPilot request failed: ${err instanceof Error ? err.message : String(err)}`,
        0,
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export class PolarPilotError extends Error {
  constructor(message: string, public readonly statusCode: number) {
    super(message);
    this.name = 'PolarPilotError';
  }
}
