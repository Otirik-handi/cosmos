/**
 * 模型页（`/models`）文案。入口与边界来自已接受的 Proposal
 * `connection-credential-entry-v1.md`：先配服务商与模型，再到连接里选模型。
 *
 * 这里只有一句产品承诺是硬要求：保存不调用模型。用户填完 key 就点保存时，
 * 界面必须明确说这次保存没有发生任何请求，否则「保存成功」会被读成「认证通过」。
 */
export const models = {
    provider: {
        title: "服务商",
        empty: "还没有配置服务商。先添加一个，再为它录入或发现模型。",
        count: (count: number) => `${count} 个服务商`,
        add: "添加服务商",
        addTitle: "添加服务商",
        editTitle: "编辑服务商",
        name: "名称",
        api: "协议",
        apiHint: "选它实际提供的接口形态；两种协议的请求体不同，选错会在调用时失败",
        protocols: {
            completions: "OpenAI Chat Completions",
            responses: "OpenAI Responses",
        },
        baseUrl: "基础地址",
        baseUrlHint: "只接受公网 HTTPS 地址，例如 https://api.openai.com/v1",
        apiKey: "API Key",
        apiKeyCreateHint: "Key 交给本地凭证存储保管，界面不会显示已保存的值",
        apiKeyKeepHint: "留空表示保留已保存的 Key",
        create: "添加",
        save: "保存",
        cancel: "取消",
        edit: "编辑",
        /** 产品承诺：这次保存没有发生任何模型请求。 */
        createsNoCall: "保存不调用模型",
        credentialConfigured: "已保存凭证",
        credentialCleanupPending: "旧凭证还没清理完，保存会再试一次",
        /** 只开一个编辑框：展开与编辑同一行时用 aria-expanded 表达状态。 */
        expand: (name: string) => `展开「${name}」的模型`,
        collapse: (name: string) => `收起「${name}」的模型`,
    },
    models: {
        title: "模型",
        empty: "这个服务商还没有模型。先获取列表，或直接手动录入。",
        count: (count: number) => `${count} 个模型`,
        manualTitle: "手动录入",
        manualHint: "上游不支持列表接口时用这里，填入调用时使用的模型 ID",
        modelId: "模型 ID",
        name: "显示名称",
        contextWindow: "上下文窗口（token）",
        maxOutputTokens: "单次输出上限（token）",
        add: "添加模型",
        remove: "移除",
        removeConfirm: (name: string) => `移除「${name}」？引用它的连接会失去这个模型。`,
        /** 发现只给模型 ID 与名称，调用所需预算必须由用户补，不能凭空推断。 */
        discoveryFillsId: "已填入模型 ID 与名称，请补上预算字段再添加。",
    },
    discovery: {
        action: "获取模型列表",
        hint: "会向这个服务商请求一次模型列表，不会发起模型调用",
        running: "正在读取上游模型列表…",
        found: (count: number) => `上游返回 ${count} 个模型；选择要用的模型补全信息后添加。`,
        empty: "上游没有返回可用模型。可以手动录入模型 ID。",
        configured: "已添加",
        add: "添加到录入栏",
        reasons: {
            authentication: "认证失败：检查 API Key 是否正确、是否已过期。",
            unsupported: "这个服务商不支持模型列表接口，请手动录入模型。",
            timeout: "等待上游响应超时，可以再试一次。",
            tooLarge: "上游返回内容过大，已停止读取。",
            malformed: "上游返回的内容无法解析为模型列表。",
            unreachable: "暂时连不上上游，可以稍后再试。",
        },
    },
    /**
     * 连接一侧的模型选择。连接与「服务商/模型」是两件事：连接说「用哪个模型」，
     * 模型本身在 `/models` 配。所以这里只提供选择与跳过去补配置的提示。
     */
    connection: {
        label: "模型",
        unset: "还没选模型",
        missing: "配置缺失：选中的模型已不在列表里",
        missingHint: "到「模型」页重新添加这个模型，或在这里换一个。",
        select: "选择模型",
        selectTitle: "选择模型",
        selectHint: "只列出已配置的模型；带预算字段才能在调用时使用。",
        change: "更换模型",
        /** 行内控件的可见名就有歧义（同一行可能有两个按钮），所以无障碍名带上连接名。 */
        selectLabel: (name: string) => `选择模型 ${name}`,
        saveLabel: (name: string) => `保存模型选择 ${name}`,
        empty: "还没有可用模型。先到「模型」页添加服务商与模型。",
        loading: "正在读取可用模型…",
        loadFailed: "可用模型读取失败。",
        save: "保存",
        cancel: "取消",
        notices: {
            versionConflict: "这条连接刚被改过，已重新读取，请再选一次。",
            invalidSelection: "这个模型现在不能选：可能所属服务商正在删除。",
            notFound: "这条连接已经不在了，已重新读取列表。",
            unavailable: "保存失败，请稍后重试。",
        },
    },
    /** 写操作失败的恢复提示。恢复动作不同，所以句子不能合并成一句「保存失败」。 */
    notices: {
        versionConflict: "服务商已被其它修改更新，已重新读取，请再保存一次。",
        credentialMissing: "这个服务商还没有可用的凭证，先在编辑里保存 API Key。",
        operationInProgress: "同一个服务商还有一次保存在进行中，稍等再试。",
        cleanupPending: "配置已保存，但旧凭证还没清理完；再点一次保存会继续清理。",
        credentialWriteFailed: "配置没有保存成功：本地凭证写入失败，可以再试一次。",
        notFound: "这个配置已经不在了，已重新读取列表。",
        payloadTooLarge: "提交内容过大，已被拒绝。",
        unavailable: "保存失败，请稍后重试。",
        /** 202：服务端仍未完成凭证写入。不能显示成成功。 */
        stillPending: "保存已提交，但服务端还没完成凭证写入；稍后重新打开列表查看结果。",
        saved: "已保存。保存不调用模型。",
        modelSaved: "已添加模型。",
        discoveryFailed: "获取模型列表失败。",
    },
    errors: {
        name: "名称不能为空，最多 200 个字符。",
        address: "基础地址必须是公网 HTTPS 地址，不能带端口、查询参数或账号密码。",
        credential: "API Key 不能为空，也不能包含换行。",
        protocol: "协议取值无效。",
        unchanged: "没有任何改动。",
        modelId: "模型 ID 不能为空，也不能是网址。",
        contextWindow: "上下文窗口必须是正整数。",
        maxOutputTokens: "输出上限必须是正整数，且不超过上下文窗口。",
        load: "读取服务商列表失败。",
        loading: "正在读取服务商列表…",
        modelsLoadFailed: "读取模型列表失败。",
        modelsLoading: "正在读取模型…",
    },
} as const;
