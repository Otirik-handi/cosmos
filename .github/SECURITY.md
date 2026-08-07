# 安全政策 / Security Policy

## 私密报告漏洞 / Report Vulnerabilities Privately

如果你发现了可能影响 Cosmos 用户、数据或运行环境的安全漏洞，请在公开仓库启用后通过 GitHub 仓库的 Security 页面使用 Private Vulnerability Reporting 私密提交。若该入口尚未启用，请使用仓库主页公布的维护者私密联系渠道；在找到私密渠道前不要创建公开 Issue、Discussion 或 Pull Request，也不要在公开渠道披露复现细节。

If you discover a vulnerability that may affect Cosmos users, data, or runtime environments, use Private Vulnerability Reporting from the repository's GitHub Security page after it is enabled. If that entry is not enabled yet, use the maintainer's private contact channel published on the repository home page. Until a private channel is available, do not open a public issue, discussion, or pull request, and do not disclose reproduction details in public channels.

安全问题包括但不限于：鉴权绕过、任意文件读写、路径越界、远程代码执行、Secret 或私人内容泄露、恶意依赖导致的权限提升，以及跨数据根访问不属于当前授权范围的数据。普通安装失败、性能问题和不包含安全影响的 Bug 请使用公开 Issue 表单。

Examples include authentication bypass, arbitrary file access, path traversal, remote code execution, secret or private-content disclosure, privilege escalation through a malicious dependency, and access across data roots outside the authorized scope. Use the public issue forms for ordinary installation failures, performance problems, and bugs without a security impact.

## 报告内容 / What to Include

请尽量提供：

- 受影响的版本、commit 或本地构建状态；
- 操作系统、CPU 架构和运行方式；
- 漏洞影响、攻击前提和可能受影响的数据；
- 可以重复的最小步骤；
- 已脱敏的日志、截图或概念验证；
- 你是否已经在其它地方披露该问题。

Please include, when possible:

- the affected version, commit, or local build state;
- the operating system, CPU architecture, and runtime method;
- impact, prerequisites, and data that may be exposed;
- minimal repeatable steps;
- redacted logs, screenshots, or proof of concept;
- whether the issue has been disclosed elsewhere.

不要在报告中提供真实 API Key、访问令牌、私信/邮件/群聊正文、完整 Session、Trace 或不必要的个人数据。请使用最小化的测试账户和合成数据。

Do not include real API keys, access tokens, private messages/emails/group content, complete sessions, traces, or unnecessary personal data. Use minimal test accounts and synthetic data.

## 支持范围 / Supported Versions

安全修复面向当前默认分支和最新公开版本。旧版本通常需要先升级到最新版本才能获得修复；项目是否为历史发布线提供单独补丁，以维护者公告为准。

Security fixes target the current default branch and the latest public release. Older versions will usually need to upgrade to receive a fix; separate patches for historical release lines depend on maintainer policy.

## 协调与披露 / Coordination and Disclosure

维护者会在可用时通过私密报告线程确认问题、请求补充材料并协调修复和公开时间。请在双方商定时间前保持漏洞私密。项目当前不承诺固定响应时限、漏洞赏金或奖金；提交高质量报告也不自动形成付款或雇佣关系。

When available, maintainers will use the private report thread to confirm the issue, request details, and coordinate remediation and disclosure. Keep the vulnerability private until an agreed disclosure time. The project does not currently promise a fixed response SLA, bug bounty, or reward; a high-quality report does not create a payment or employment relationship.
