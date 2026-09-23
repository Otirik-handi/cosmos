-- 连接的登录探测时间（Proposal connection-login-lifecycle-v1 决定 2）。
-- 只加列：探测结果的状态/账号/失效原因复用既有列，历史行保持「从未探测」（NULL）。
ALTER TABLE "ConnectionInstance" ADD COLUMN "lastCheckedAt" DATETIME;
