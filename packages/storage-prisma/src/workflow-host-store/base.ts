import { type RetryPolicy } from "@cosmos/contracts";
import { PrismaClient } from "@prisma/client";
import { type LoggerPort } from "@cosmos/application";
import { type PrismaOptions } from "./internals-core.js";
import { isPrismaOptions } from "./internals-activity.js";

export class PrismaWorkflowHostStoreBase {
    readonly prisma: PrismaClient;
    protected readonly logger?: LoggerPort;
    protected readonly actionRetryPolicies?: Readonly<Record<string, RetryPolicy>>;

    constructor(prisma: PrismaClient, options?: { logger?: LoggerPort; actionRetryPolicies?: Readonly<Record<string, RetryPolicy>> });
    constructor(options: PrismaOptions);
    constructor(
        input: PrismaClient | PrismaOptions,
        options?: { logger?: LoggerPort; actionRetryPolicies?: Readonly<Record<string, RetryPolicy>> },
    ) {
        if (isPrismaOptions(input)) {
            this.prisma = input.prisma;
            this.logger = input.logger;
            this.actionRetryPolicies = input.actionRetryPolicies;
        } else {
            this.prisma = input;
            this.logger = options?.logger;
            this.actionRetryPolicies = options?.actionRetryPolicies;
        }
    }

}
