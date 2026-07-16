const PREFERRED_PORT = 3910;

export function resolveManagedPort(
  env: Record<string, string | undefined>,
  preferredPort = PREFERRED_PORT,
): number {
  if (env.POLAR_RUNTIME_MANAGED !== '1') {
    throw new Error('PolarClaw must be started by PolarProcess');
  }

  const port = Number(env.PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('managed PolarClaw requires a valid injected PORT');
  }
  if (port !== preferredPort) {
    throw new Error(`injected PORT ${port} does not match preferred port ${preferredPort}`);
  }
  return port;
}
