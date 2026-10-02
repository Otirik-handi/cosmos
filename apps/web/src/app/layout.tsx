import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LiveProvider } from "@/components/shell/live-provider";
import { messages } from "@/copy/messages";
import { ThemeProvider } from "@/theme/theme-provider";
import { COSMOS_THEME_BOOTSTRAP_SCRIPT } from "@/theme/theme-bootstrap";

import "./globals.css";

export const metadata: Metadata = {
    title: "Cosmos",
    description: messages.pages.layout.description,
};

/*
 * 不再引入 next/font：V4 的字族合同是系统栈（--font-ui / --font-serif / --font-mono），
 * 见 globals.css。少了构建期字体下载，也避免中英文混排时出现两种字形。
 *
 * LiveProvider 挂在根布局而不是路由组里：EventSource 必须跨路由组存活，
 * 否则每次切组都会新建连接，E7 的「全程恰好 1 条」预算就不成立。
 */
export default function RootLayout({ children }: { children: ReactNode }) {
    return (
        <html
            lang="zh-CN"
            suppressHydrationWarning
            className="h-full antialiased"
        >
            <head>
                <script dangerouslySetInnerHTML={{__html: COSMOS_THEME_BOOTSTRAP_SCRIPT}} />
            </head>
            <body suppressHydrationWarning className="min-h-full flex flex-col">
                <ThemeProvider>
                    <LiveProvider>{children}</LiveProvider>
                </ThemeProvider>
            </body>
        </html>
    );
}

