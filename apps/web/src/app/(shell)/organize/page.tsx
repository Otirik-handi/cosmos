"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { messages } from "@/copy/messages";

import { AnnotationsSection } from "./annotations-section";
import { CollectionsSection } from "./collections-section";
import { FavoritesSection } from "./favorites-section";
import { LabelsSection } from "./labels-section";
import { ViewsSection } from "./views-section";

/*
 * 整理：用户组织五个分区一页内并列（D6）。
 *
 * 分区用 query（`?tab=`）而不是路径段——它们是同一页内的分区，不是独立页面，这样
 * URL 层级与导航层级仍然一致（ADR-0029 决策 3）。刷新与分享都保留当前分区。
 *
 * 一个页面一处 ToastHost：五个分区的写命令回执都走它，各自不重复挂宿主。
 */

const TABS = [
    { id: "labels", label: messages.organize.tabs.labels },
    { id: "collections", label: messages.organize.tabs.collections },
    { id: "favorites", label: messages.organize.tabs.favorites },
    { id: "annotations", label: messages.organize.tabs.annotations },
    { id: "views", label: messages.organize.tabs.views },
] as const;

type TabId = (typeof TABS)[number]["id"];

function isTabId(value: string | null): value is TabId {
    return TABS.some((tab) => tab.id === value);
}

function OrganizeSections() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const requested = searchParams.get("tab");
    const active: TabId = isTabId(requested) ? requested : "labels";

    const select = (next: string): void => {
        // 默认分区不进 URL，保持地址干净；其它分区写进 query 以便刷新与分享。
        router.replace(next === "labels" ? "/organize" : `/organize?tab=${next}`, { scroll: false });
    };

    /*
     * Provider 与宿主由 `(shell)/layout.tsx` 提供（全内容组共用一处），这里只负责页面。
     * 五个分区的写回执都走 `useToast`，各自不重复挂宿主。
     */
    return (
        <div className="flex w-full flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[15px] font-medium">{messages.organize.title}</h1>
                <span className="text-[12px] text-muted-foreground">
                    {messages.organize.description}
                </span>
            </div>

                <Tabs onValueChange={select} value={active}>
                    <TabsList>
                        {TABS.map((tab) => (
                            <TabsTrigger key={tab.id} value={tab.id}>
                                {tab.label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                    <TabsContent value="labels">
                        <LabelsSection />
                    </TabsContent>
                    <TabsContent value="collections">
                        <CollectionsSection />
                    </TabsContent>
                    <TabsContent value="favorites">
                        <FavoritesSection />
                    </TabsContent>
                    <TabsContent value="annotations">
                        <AnnotationsSection />
                    </TabsContent>
                    <TabsContent value="views">
                        <ViewsSection />
                    </TabsContent>
                </Tabs>
        </div>
    );
}

export default function OrganizePage() {
    return (
        <Suspense fallback={<p className="text-[13px] text-muted-foreground">{messages.common.loading}</p>}>
            <OrganizeSections />
        </Suspense>
    );
}
