import "reflect-metadata";
import { Controller, Get, Header, HttpException, Inject, Param, Query } from "@nestjs/common";
import type { ModelProviderQuery } from "@cosmos/application";

type Reader = Pick<ModelProviderQuery, "list" | "get" | "operation" | "operationByKey">;
function failure(code: "invalid_input" | "not_found" | "dependency_unavailable"): HttpException {
    return new HttpException({ code, message: "Model configuration query failed.", retryable: code === "dependency_unavailable" },
        code === "invalid_input" ? 400 : code === "not_found" ? 404 : 503);
}

@Controller()
export class ModelProviderController {
    constructor(@Inject("COSMOS_MODEL_PROVIDER_QUERY") private readonly reader: Reader) {}

    @Get("model-providers")
    @Header("Cache-Control", "no-store")
    async list(@Query("limit") limit?: unknown, @Query("cursor") cursor?: unknown) {
        if (limit !== undefined && (typeof limit !== "string" || !/^[1-9]\d{0,2}$/.test(limit) || Number(limit) > 100)) throw failure("invalid_input");
        if (cursor !== undefined && typeof cursor !== "string") throw failure("invalid_input");
        return this.safe(() => this.reader.list({
            ...(limit === undefined ? {} : { limit: Number(limit) }),
            ...(cursor === undefined ? {} : { cursor }),
        }));
    }

    @Get("model-providers/:id")
    @Header("Cache-Control", "no-store")
    get(@Param("id") id: string) { return this.safe(() => this.reader.get(id)); }

    @Get("model-configuration-operations/by-key/:key")
    @Header("Cache-Control", "no-store")
    byKey(@Param("key") key: string) { return this.safe(() => this.reader.operationByKey(key)); }

    @Get("model-configuration-operations/:id")
    @Header("Cache-Control", "no-store")
    operation(@Param("id") id: string) { return this.safe(() => this.reader.operation(id)); }

    private async safe<T>(use: () => Promise<T>): Promise<T> {
        try { return await use(); } catch (error) {
            let code: "invalid_input" | "not_found" | "dependency_unavailable" = "dependency_unavailable";
            try {
                if (typeof error === "object" && error !== null && "code" in error
                    && (error.code === "invalid_input" || error.code === "not_found")) code = error.code;
            } catch { /* Dependency failures must not expose throwing error accessors. */ }
            throw failure(code);
        }
    }
}
