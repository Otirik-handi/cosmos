import type { NextConfig } from "next";

const apiUrl = process.env.COSMOS_API_URL ?? "http://localhost:4310";

const nextConfig: NextConfig = {
    output: "standalone",
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
