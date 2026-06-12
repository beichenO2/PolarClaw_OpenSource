/**
 * PolarPrivate Secrets → process.env 加载器
 *
 * DEPRECATED (260505 batch — Plaintext Export Ban):
 * The /api/secrets/{id}/reveal endpoint has been permanently removed.
 * Injecting plaintext secrets into process.env is also discouraged because
 * environment variables leak to subprocess and crash logs.
 *
 * Migration:
 *  - HMAC scenarios (B-class): call PolarPrivate /sign/{provider}/{action}
 *  - OAuth bearer tokens (A-class): proxy through /proxy/{service}/{path}
 *  - Third-party SDK protocols (D-class): use /api/d-class/grant with
 *    binary SHA256 allowlist
 *
 * This module is kept as a no-op so existing call sites do not crash;
 * remove the import and replace with the appropriate interface.
 */

export interface ISecretsLoaderOptions {
  baseUrl: string;
  projectName: string;
  timeoutMs?: number;
}

export async function loadSecretsToEnv(_options: ISecretsLoaderOptions): Promise<number> {
  console.warn(
    '[secrets-loader] DEPRECATED: PolarPrivate plaintext export endpoints removed (260505 batch). ' +
    'Use /sign/{provider}/{action}, /proxy/*, or /api/d-class/grant instead. Returning 0.'
  );
  return 0;
}
