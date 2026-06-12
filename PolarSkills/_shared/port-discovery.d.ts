/**
 * Shared port discovery for PolarClaw skills.
 *
 * Uses SOTAgent port-sdk to discover service ports dynamically.
 * Includes CircuitBreaker for resilient external service calls.
 */
interface CircuitState {
    failures: number;
    lastFailure: number;
    state: 'closed' | 'open' | 'half-open';
}
export declare function getCircuit(serviceName: string): CircuitState;
export declare function recordSuccess(serviceName: string): void;
export declare function recordFailure(serviceName: string): void;
export declare function isCircuitOpen(serviceName: string): boolean;
/**
 * Check if a service is reachable via HTTP health probe.
 */
export declare function isHealthy(url: string, timeoutMs?: number): Promise<boolean>;
export declare function getServicePort(serviceName: string): Promise<number | null>;
export declare function getGatewayUrl(servicePrefix: string): string;
export declare function getServiceUrl(serviceName: string, gatewayPrefix?: string): Promise<string>;
/**
 * Resilient service call: respects circuit breaker.
 * Returns { ok, data } or { ok: false, error, circuitOpen }.
 */
export declare function resilientFetch<T>(serviceName: string, url: string, opts?: RequestInit, timeoutMs?: number): Promise<{
    ok: true;
    data: T;
} | {
    ok: false;
    error: string;
    circuitOpen: boolean;
}>;
/** Well-known service names and their gateway prefixes */
export declare const SERVICES: {
    readonly DIGIST: {
        readonly name: "digist-api";
        readonly gateway: "digist";
    };
    readonly KNOWLEVER_RAG: {
        readonly name: "knowlever-rag";
        readonly gateway: "knowlever";
    };
    readonly AUTOOFFICE: {
        readonly name: "autooffice";
        readonly gateway: "autooffice";
    };
    readonly CLOCK: {
        readonly name: "clock-backend";
        readonly gateway: "clock";
    };
    readonly POLARPRIVATE: {
        readonly name: "polarprivate-backend";
        readonly gateway: "polarprivate";
    };
};
export {};
//# sourceMappingURL=port-discovery.d.ts.map