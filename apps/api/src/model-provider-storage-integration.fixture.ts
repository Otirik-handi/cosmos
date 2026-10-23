export const harness = `import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "./generated-client/index.js";
import { ModelProviderCredentials } from "./credentials.js";
import { ModelProviderQuery } from "./query.js";
import { PrismaProviderCredentialRepository } from "./credential-repository.js";
import { PrismaModelProviderQueryRepository } from "./query-repository.js";
import { FileSecretStore } from "./file-secrets.js";
import { withModelConfigurationLock } from "./lock.js";
import { ModelProviderController } from "./read-controller.js";
import { ModelProviderWriteController } from "./write-controller.js";
const root = process.cwd();
const client = new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL!}}});
const secrets = new FileSecretStore({root:resolve(root,"secrets")});
const repository = new PrismaProviderCredentialRepository(client);
const query = new ModelProviderQuery(new PrismaModelProviderQueryRepository(client));
let conflictNext = false;
let deleteFails = false;
let puts = 0;
const credentials = new ModelProviderCredentials({repository, operationId:randomUUID,
    lock:(id,use)=>withModelConfigurationLock(root,id,use),
    secrets:{
        async put(ref,value) {
            puts++;
            await secrets.put(ref,value);
            if (conflictNext) {
                conflictNext = false;
                const operation = await client.modelConfigurationOperation.findFirstOrThrow({where:{newSecretRef:ref}});
                await client.modelProvider.update({where:{id:operation.providerId},data:{version:{increment:1}}});
            }
        },
        async delete(ref) { if(deleteFails) throw new Error("Synthetic cleanup fault"); return secrets.delete(ref); },
    },
});
const trust = {origins:["http://localhost:4300"],authorities:[] as string[]};
@Module({controllers:[ModelProviderController,ModelProviderWriteController],providers:[
    {provide:"COSMOS_MODEL_CONFIGURATION_TRUST",useValue:trust},
    {provide:"COSMOS_MODEL_PROVIDER_CREDENTIALS",useValue:credentials},
    {provide:"COSMOS_MODEL_PROVIDER_QUERY",useValue:query},
    {provide:"COSMOS_MODEL_PROVIDER_REMOVALS",useValue:{async remove(){throw new Error("Synthetic removal not exercised here.");}}},
]})
class TestModule {}
const app = await NestFactory.create(TestModule,{logger:false,bodyParser:false});
const nativeFetch = globalThis.fetch;
let providerRequests = 0;
try {
    const lockId = randomUUID();
    let entered!: () => void;
    let release!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const hold = new Promise<void>(resolve => { release = resolve; });
    const owner = withModelConfigurationLock(root,lockId,async () => { entered(); await hold; });
    try {
        await Promise.race([ready, owner]);
        await assert.rejects(withModelConfigurationLock(root,lockId,async () => {
            assert.fail("Competing operation entered the lock");
        }), (error:unknown) => error instanceof Error && "code" in error && error.code === "operation_in_progress");
    } finally { release(); await owner; }
    assert.equal(await withModelConfigurationLock(root,lockId,async () => "released"),"released");
    app.setGlobalPrefix("api/v1");
    await app.listen(0,"127.0.0.1");
    const base = await app.getUrl();
    trust.authorities.push(new URL(base).host);
    // Any accidental Provider fetch must fail before it can leave this process.
    globalThis.fetch = (input,init) => {
        const url = new URL(input instanceof Request ? input.url : String(input));
        if (url.origin !== base) { providerRequests++; throw new Error("Non-test destination blocked"); }
        return nativeFetch(input,init);
    };
    const request = async (path:string, body?:unknown, method="GET",key=randomUUID()) => {
        const response = await fetch(base+"/api/v1/"+path,{method,headers:{Origin:trust.origins[0]!,
            "Content-Type":"application/json","Idempotency-Key":key},
            ...(body===undefined?{}:{body:JSON.stringify(body)})});
        assert.equal(response.headers.get("cache-control"),"no-store");
        const text = await response.text();
        assert.ok(!text.includes("SYNTHETIC_KEY"));
        assert.ok(!text.includes("model-provider:"));
        return {status:response.status,body:JSON.parse(text),id:response.headers.get("x-cosmos-operation-id")};
    };
    const command = {name:"Synthetic",api:"openai-completions",baseUrl:"https://example.com/v1",apiKey:"SYNTHETIC_KEY_1"};
    const key = randomUUID();
    const created = await request("model-providers",command,"POST",key);
    assert.equal(created.status,201);
    const providerId:string = created.body.id;
    assert.equal(created.body.version,1);
    const first = await client.modelProvider.findUniqueOrThrow({where:{id:providerId}});
    assert.equal(await secrets.read(first.secretRef!),command.apiKey);
    const replay = await request("model-providers",command,"POST",key);
    assert.equal(replay.status,202);
    assert.equal(replay.body.id,created.id);
    assert.equal(puts,1);
    const replaced = await request("model-providers/"+providerId,{expectedVersion:1,apiKey:"SYNTHETIC_KEY_2"},"PATCH");
    assert.equal(replaced.status,200);
    assert.equal(replaced.body.version,2);
    assert.equal(await secrets.read(first.secretRef!),null);
    const second = await client.modelProvider.findUniqueOrThrow({where:{id:providerId}});
    assert.equal(await secrets.read(second.secretRef!),"SYNTHETIC_KEY_2");
    const retained = await request("model-providers/"+providerId,{expectedVersion:2,name:"Renamed"},"PATCH");
    assert.equal(retained.status,200);
    assert.equal(retained.body.version,3);
    assert.equal(puts,2);
    conflictNext = true;
    const conflictKey = randomUUID();
    const conflictBody = {expectedVersion:3,apiKey:"SYNTHETIC_KEY_CONFLICT"};
    const conflicted = await request("model-providers/"+providerId,conflictBody,"PATCH",conflictKey);
    assert.equal(conflicted.status,409);
    assert.equal(conflicted.body.code,"version_conflict");
    const failed = await request("model-configuration-operations/"+conflicted.id);
    assert.equal(failed.body.state,"failed");
    assert.equal(failed.body.errorCode,"version_conflict");
    const conflictReplay = await request("model-providers/"+providerId,conflictBody,"PATCH",conflictKey);
    assert.equal(conflictReplay.status,202);
    assert.deepEqual(conflictReplay.body,failed.body);
    assert.deepEqual((await request("model-configuration-operations/by-key/"+conflictKey)).body,failed.body);
    const conflictRow = await client.modelConfigurationOperation.findUniqueOrThrow({where:{id:conflicted.id!}});
    assert.equal(await secrets.read(conflictRow.newSecretRef!),null);
    assert.equal(await secrets.read(second.secretRef!),"SYNTHETIC_KEY_2");
    deleteFails = true;
    const pending = await request("model-providers/"+providerId,{expectedVersion:4,apiKey:"SYNTHETIC_KEY_3"},"PATCH");
    assert.equal(pending.status,503);
    assert.equal(pending.body.code,"cleanup_pending");
    assert.equal(pending.body.resourceVersion,5);
    assert.equal((await request("model-configuration-operations/"+pending.id)).body.state,"cleanup_pending");
    assert.equal(await secrets.read(second.secretRef!),"SYNTHETIC_KEY_2");
    deleteFails = false;
    const recovered = await request("model-configuration-operations/"+pending.id+"/retries",{},"POST");
    assert.equal(recovered.status,202);
    assert.equal(recovered.body.state,"completed");
    assert.equal(await secrets.read(second.secretRef!),null);
    const final = await client.modelProvider.findUniqueOrThrow({where:{id:providerId}});
    assert.equal(final.pendingOperationId,null);
    assert.equal(await secrets.read(final.secretRef!),"SYNTHETIC_KEY_3");
    assert.deepEqual(await client.$queryRawUnsafe("PRAGMA foreign_key_check"),[]);
    assert.equal(providerRequests,0);
    await writeFile("verification.json",JSON.stringify({status:"passed",create:true,replace:true,replay:true,
        conflict:true,cleanupRecovery:true,nativeLock:true,foreignKeys:true,providerRequests},null,2));
} finally {
    globalThis.fetch = nativeFetch;
    await app.close();
    await client.$disconnect();
}
`;
