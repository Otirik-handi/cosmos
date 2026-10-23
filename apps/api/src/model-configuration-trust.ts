interface TrustEnvironment {
    COSMOS_ALLOWED_ORIGIN?: string;
    COSMOS_MODEL_CONFIGURATION_AUTHORITIES?: string;
}

/** Missing or noncanonical configuration denies writes; request headers never supply defaults. */
export function resolveModelConfigurationTrust(env: TrustEnvironment): { origins: string[]; authorities: string[] } {
    const denied = { origins: [], authorities: [] };
    const origin = env.COSMOS_ALLOWED_ORIGIN?.trim();
    const authorities = env.COSMOS_MODEL_CONFIGURATION_AUTHORITIES?.split(",").map((value) => value.trim());
    if (!origin || !authorities?.length) return denied;
    try {
        const web = new URL(origin);
        if (!/^https?:$/.test(web.protocol) || web.origin !== origin) return denied;
        for (const authority of authorities) {
            const api = new URL(`http://${authority}`);
            if (!authority || authority.includes("*") || api.host !== authority || api.username || api.password
                || api.pathname !== "/" || api.search || api.hash) return denied;
        }
        return { origins: [origin], authorities: [...new Set(authorities)] };
    } catch { return denied; }
}
