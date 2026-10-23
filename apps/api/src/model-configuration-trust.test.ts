import { describe, expect, it } from "vitest";
import { resolveModelConfigurationTrust } from "./model-configuration-trust.js";
import { assertModelConfigurationWrite } from "./model-configuration-write-policy.js";

describe("explicit model configuration trust", () => {
    it("requires both settings and rejects malformed or wildcard values", () => {
        for (const env of [{}, { COSMOS_ALLOWED_ORIGIN: "http://localhost:4300" },
            { COSMOS_ALLOWED_ORIGIN: "*", COSMOS_MODEL_CONFIGURATION_AUTHORITIES: "localhost:4310" },
            { COSMOS_ALLOWED_ORIGIN: "https://web.example/path", COSMOS_MODEL_CONFIGURATION_AUTHORITIES: "api.example" },
            { COSMOS_ALLOWED_ORIGIN: "https://web.example", COSMOS_MODEL_CONFIGURATION_AUTHORITIES: "api.example, *" },
            { COSMOS_ALLOWED_ORIGIN: "https://web.example", COSMOS_MODEL_CONFIGURATION_AUTHORITIES: "https://api.example" },
        ]) {
            const trust = resolveModelConfigurationTrust(env);
            expect(() => assertModelConfigurationWrite(trust, {
                origin: "http://localhost:4300", host: "localhost:4310", contentType: "application/json", bodyBytes: 0,
            })).toThrowError(expect.objectContaining({ code: "forbidden_origin" }));
            expect(trust).toEqual({ origins: [], authorities: [] });
        }
    });
    it("accepts explicit canonical origins and DNS/IPv6 authorities without deriving aliases", () => {
        const trust = resolveModelConfigurationTrust({ COSMOS_ALLOWED_ORIGIN: "https://web.example",
            COSMOS_MODEL_CONFIGURATION_AUTHORITIES: "api.example:4310, [::1]:4310" });
        expect(trust).toEqual({ origins: ["https://web.example"], authorities: ["api.example:4310", "[::1]:4310"] });
        expect(() => assertModelConfigurationWrite(trust, {
            origin: "https://web.example", host: "api.example:4310", contentType: "application/json", bodyBytes: 0,
        })).not.toThrow();
        expect(() => assertModelConfigurationWrite(trust, {
            origin: "https://web.example", host: "localhost:4310", contentType: "application/json", bodyBytes: 0,
        })).toThrow();
    });
});
