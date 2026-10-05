import type { NextConfig } from "next";

const apiUrl = process.env.COSMOS_API_URL ?? "http://localhost:4310";

const nextConfig: NextConfig = {
    output: "standalone",
    /*
     * Next 16 默认拦截「跨源」访问 dev 资源（chunk 与 HMR 都返回 403），而本仓库的浏览器
     * 验收配置就是用 `127.0.0.1` 访问 dev server（`playwright.component-lab.config.ts` 的
     * baseURL 与 `bun run --cwd apps/web dev -- --hostname 127.0.0.1`）。放行这两个回环主机名，
     * 否则手工起 dev server 时页面停在服务端渲染的初始帧、控制台一片 403。
     * 只影响开发态：生产构建不读这个键。
     */
    allowedDevOrigins: ["127.0.0.1", "localhost"],
    logging: {
        incomingRequests: false,
        browserToTerminal: false,
    },
    async rewrites() {
        return [{
            source: "/api/:path*",
            destination: `${apiUrl}/api/:path*`,
        }, {
            // Webhook 入口（ADR-0024）由 API 进程提供，但它不在 /api/v1 下。这里透传一层，
            // 让产品面给出的入口地址与用户当前访问的地址同源，复制即可用。
            source: "/hooks/:path*",
            destination: `${apiUrl}/hooks/:path*`,
        }];
    },
};

export default nextConfig;
