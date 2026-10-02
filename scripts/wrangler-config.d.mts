// Types du générateur de configuration (scripts/wrangler-config.mjs), pour les tests en TypeScript.
export declare const OPTIONAL_VARS: readonly string[];
export declare function buildWranglerConfig(template: string, values: Record<string, string | undefined>): string;
