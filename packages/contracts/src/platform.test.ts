import { expect, it } from "vitest";
import { serviceErrorCodeSchema, serviceErrorSchema } from "./platform.js";

it("preserves existing service errors and admits the approved Provider configuration codes", () => {
    const codes = ["validation_failed", "not_found", "conflict", "service_unavailable", "protocol_mismatch", "uncertain",
        "invalid_input", "forbidden_origin", "version_conflict", "in_use", "operation_in_progress", "payload_too_large",
        "credential_write_failed", "cleanup_pending", "dependency_unavailable"];
    for (const code of codes) {
        expect(serviceErrorCodeSchema.safeParse(code).success, code).toBe(true);
        expect(serviceErrorSchema.safeParse({ code, message: "Safe failure.", retryable: false }).success, code).toBe(true);
    }
    expect(serviceErrorCodeSchema.safeParse("PRIVATE_UPSTREAM_ERROR").success).toBe(false);
});

it("preserves only valid operation recovery identifiers in service errors", () => {
    const error = { code: "dependency_unavailable", message: "Safe failure.", retryable: true, operationId: "operation:123-abc" };
    expect(serviceErrorSchema.parse(error)).toEqual(error);
    for (const operationId of ["", "has space", "line\nbreak", "x".repeat(201), 123, null]) {
        expect(serviceErrorSchema.safeParse({ ...error, operationId }).success).toBe(false);
    }
});
