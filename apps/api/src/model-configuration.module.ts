import { Module, type DynamicModule } from "@nestjs/common";
import type {
    ConfiguredModels, ModelProviderCredentials, ModelProviderQuery, ModelProviderRemovals, ProviderModelDiscoveryRunner,
} from "@cosmos/application";
import { ConfiguredModelController } from "./configured-model.controller.js";
import { ModelProviderController } from "./model-provider.controller.js";
import { ModelProviderWriteController } from "./model-provider-write.controller.js";
import { ProviderModelDiscoveryController } from "./provider-model-discovery.controller.js";

interface ModelConfigurationDependencies {
    trust: { origins: readonly string[]; authorities: readonly string[] };
    credentials: Pick<ModelProviderCredentials, "save" | "retry">;
    query: Pick<ModelProviderQuery, "list" | "get" | "operation" | "operationByKey">;
    models: Pick<ConfiguredModels, "list" | "get" | "create" | "update" | "delete">;
    removals: Pick<ModelProviderRemovals, "remove">;
    discovery: Pick<ProviderModelDiscoveryRunner, "discover">;
}

@Module({})
export class ModelConfigurationModule {
    /** Composition supplies existing storage owners; importing this module performs no storage I/O. */
    static register(dependencies: ModelConfigurationDependencies): DynamicModule {
        return {
            module: ModelConfigurationModule,
            controllers: [
                ConfiguredModelController, ModelProviderController, ModelProviderWriteController,
                ProviderModelDiscoveryController,
            ],
            providers: [
                { provide: "COSMOS_MODEL_CONFIGURATION_TRUST", useValue: dependencies.trust },
                { provide: "COSMOS_MODEL_PROVIDER_CREDENTIALS", useValue: dependencies.credentials },
                { provide: "COSMOS_MODEL_PROVIDER_QUERY", useValue: dependencies.query },
                { provide: "COSMOS_CONFIGURED_MODELS", useValue: dependencies.models },
                { provide: "COSMOS_MODEL_PROVIDER_REMOVALS", useValue: dependencies.removals },
                { provide: "COSMOS_PROVIDER_MODEL_DISCOVERY", useValue: dependencies.discovery },
            ],
        };
    }
}
