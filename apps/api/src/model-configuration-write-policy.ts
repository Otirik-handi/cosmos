interface WriteTrust {
    origins: readonly string[];
    authorities: readonly string[];
}
interface WriteMetadata {
    origin: unknown;
    host: unknown;
    contentType: unknown;
    bodyBytes: number;
}
function reject(code: "forbidden_origin" | "invalid_input" | "payload_too_large"): never {
    throw Object.assign(new Error("Model configuration write rejected."), { code });
}

/** bodyBytes must be measured by the request reader, never copied from Content-Length. */
export function assertModelConfigurationWrite(trust: WriteTrust, request: WriteMetadata): void {
    if (typeof request.origin !== "string" || request.origin === "null"
        || !trust.origins.includes(request.origin)
        || typeof request.host !== "string" || !trust.authorities.includes(request.host)) {
        reject("forbidden_origin");
    }
    if (typeof request.contentType !== "string"
        || !/^application\/json(?:[ \t]*;[ \t]*charset=(?:utf-8|"utf-8"))?$/i.test(request.contentType)) {
        reject("invalid_input");
    }
    if (!Number.isSafeInteger(request.bodyBytes) || request.bodyBytes < 0) reject("invalid_input");
    if (request.bodyBytes > 32 * 1024) reject("payload_too_large");
}
