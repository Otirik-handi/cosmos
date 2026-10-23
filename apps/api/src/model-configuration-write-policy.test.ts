import { expect, it } from "vitest";
import { assertModelConfigurationWrite } from "./model-configuration-write-policy.js";

const trusted = { origins: ["http://localhost:4300"], authorities: ["127.0.0.1:4310"] };
const request = { origin: "http://localhost:4300", host: "127.0.0.1:4310", contentType: "application/json", bodyBytes: 32 * 1024 };
it("accepts explicit trusted JSON at the exact byte boundary", () => {
    expect(() => assertModelConfigurationWrite(trusted, request)).not.toThrow();
    expect(() => assertModelConfigurationWrite(trusted, { ...request, contentType: "application/json; charset=utf-8" })).not.toThrow();
});
it("fails closed for absent trust, Origin mismatch or untrusted Host", () => {
    for (const config of [{ origins: [], authorities: trusted.authorities }, { origins: trusted.origins, authorities: [] }]) {
        expect(() => assertModelConfigurationWrite(config, request)).toThrowError(expect.objectContaining({ code: "forbidden_origin" }));
    }
    for (const origin of [undefined, "null", "http://evil.example", "http://localhost:4300/", [request.origin]]) {
        expect(() => assertModelConfigurationWrite(trusted, { ...request, origin })).toThrowError(expect.objectContaining({ code: "forbidden_origin" }));
    }
    for (const host of [undefined, "evil.example", "127.0.0.1:4310.evil.example", [request.host]]) {
        expect(() => assertModelConfigurationWrite(trusted, { ...request, host })).toThrowError(expect.objectContaining({ code: "forbidden_origin" }));
    }
});
it("rejects non-JSON, duplicate header values and invalid measured byte counts", () => {
    for (const contentType of [undefined, "text/plain", "application/jsonp", ["application/json"], "application/json; charset=utf-8; charset=utf-8", "application/json\r\nX: value"]) {
        expect(() => assertModelConfigurationWrite(trusted, { ...request, contentType })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    }
    for (const bodyBytes of [-1, 0.5, NaN, Infinity]) {
        expect(() => assertModelConfigurationWrite(trusted, { ...request, bodyBytes })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    }
    expect(() => assertModelConfigurationWrite(trusted, { ...request, bodyBytes: 32769 })).toThrowError(expect.objectContaining({ code: "payload_too_large" }));
});
it("ignores forwarded metadata and never includes supplied input in errors", () => {
    const metadata = { ...request, origin: "PRIVATE_SENTINEL", forwardedHost: request.host, forwardedOrigin: request.origin };
    try { assertModelConfigurationWrite(trusted, metadata); throw new Error("Expected rejection."); }
    catch (error) {
        expect(error).toMatchObject({ code: "forbidden_origin", message: "Model configuration write rejected." });
        expect(String(error)).not.toContain("PRIVATE_SENTINEL");
    }
});
