import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: "standalone",
    logging: {
        incomingRequests: false,
        browserToTerminal: false,
    },
    async rewrites() {
        return [{
            source: "/api/:path*",
            destination: `${process.env.COSMOS_API_URL ?? "http://localhost:4310"}/api/:path*`,
        }];
    },
};

export default nextConfig;
