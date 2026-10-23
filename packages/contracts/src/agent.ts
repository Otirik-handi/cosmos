import { z } from "zod";

import type { JsonValue } from "./action.js";

const jsonValueSchema = z.custom<JsonValue>(
    (value): value is JsonValue => {
        if (value === null || typeof value === "string" || typeof value === "boolean") {
            return true;
        }
        if (typeof value === "number") {
            return Number.isFinite(value);
        }
        if (Array.isArray(value)) {
            return value.every((item) => jsonValueSchema.safeParse(item).success);
        }
        if (typeof value !== "object") {
            return false;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            return false;
        }
        return Object.values(value).every((item) => jsonValueSchema.safeParse(item).success);
    },
    { message: "value must be JSON-safe." },
);

export const agentInvocationMessageSchema = z.object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string(),
    name: z.string().trim().min(1).optional(),
}).strict();
export type AgentInvocationMessage = z.infer<typeof agentInvocationMessageSchema>;

export const agentInvocationToolSchema = z.object({
    name: z.string().trim().min(1),
    description: z.string().trim().min(1),
    inputSchema: jsonValueSchema,
}).strict();
export type AgentInvocationTool = z.infer<typeof agentInvocationToolSchema>;

export const agentInvocationBudgetSchema = z.object({
    maxDurationMs: z.number().int().positive(),
    maxToolCalls: z.number().int().nonnegative(),
    maxOutputTokens: z.number().int().positive(),
}).strict();
export type AgentInvocationBudget = z.infer<typeof agentInvocationBudgetSchema>;

export const agentInvocationInputSchema = z.object({
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    messages: agentInvocationMessageSchema.array().min(1),
    tools: agentInvocationToolSchema.array().default([]),
    budget: agentInvocationBudgetSchema,
    metadata: z.record(z.string(), jsonValueSchema).default({}),
}).strict();
export type AgentInvocationInput = z.infer<typeof agentInvocationInputSchema>;

/**
 * `agent.invoke@2`（API 0009「Connection 与 invocation 版本」）：调用方只给连接 ID，
 * 服务商、模型、地址与凭证全部由服务端从已保存配置解析。
 *
 * 这里用 `.strict()` 而不是在解析后丢弃多余字段：把 provider/model 静默忽略，调用方
 * 会以为自己指定的模型生效了，而实际用的是连接上的选择。
 */
export const agentInvocationV2InputSchema = z.object({
    connectionId: z.string().trim().min(1).max(200),
    messages: agentInvocationMessageSchema.array().min(1),
    tools: agentInvocationToolSchema.array().default([]),
    budget: agentInvocationBudgetSchema,
    metadata: z.record(z.string(), jsonValueSchema).default({}),
}).strict();
export type AgentInvocationV2Input = z.infer<typeof agentInvocationV2InputSchema>;

export const agentInvocationToolCallSchema = z.object({
    name: z.string().trim().min(1),
    arguments: jsonValueSchema,
}).strict();
export type AgentInvocationToolCall = z.infer<typeof agentInvocationToolCallSchema>;

export const agentInvocationUsageSchema = z.object({
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
}).strict();
export type AgentInvocationUsage = z.infer<typeof agentInvocationUsageSchema>;

export const agentInvocationOutputSchema = z.object({
    content: z.string(),
    toolCalls: agentInvocationToolCallSchema.array(),
    usage: agentInvocationUsageSchema,
    provider: z.string().trim().min(1),
    model: z.string().trim().min(1),
    finishReason: z.enum(["stop", "tool_call", "length", "cancelled"]),
    metadata: z.record(z.string(), jsonValueSchema).default({}),
}).strict();
export type AgentInvocationOutput = z.infer<typeof agentInvocationOutputSchema>;
