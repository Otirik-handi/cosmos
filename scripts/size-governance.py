#!/usr/bin/env python3
"""size-governance.py —— 递归扫描 Agent 常读的文本类文件，按大小降序输出，并提供 CI 门禁。

演进路径：根目录 findmd.ps1（只扫 .md）→ find-large-files.ps1/.py（扫描器）→ size-governance.py（本脚本，门禁化后更名）。
用途：超大文件治理的证据收集与门禁。
- 文档治理依据 docs/proposals/oversized-doc-splitting-v1.md（accepted）；
- 代码治理依据 docs/proposals/code-size-governance-v1.md（accepted）。
阈值字节与 token 双轨、先到先触发：健康区 ≤30 KB 且 ≤9k token，红线 >50 KB 或 >15k token。
门禁判定只用字节与保守 token 估算（不依赖 tiktoken），保证本地与 CI 结果一致；
token 估算口径（见 estimate_tokens）对中文密集文档偏保守（宁可高估），取代逐环境 tiktoken 计数。

用法：
  python scripts/size-governance.py                        # 扫描全部类别
  python scripts/size-governance.py -c docs code           # 只扫指定类别（空格或逗号分隔）
  python scripts/size-governance.py --top 0 --json         # 全量输出 JSON
  python scripts/size-governance.py --list-cats            # 查看类别定义
  python scripts/size-governance.py --path <目录>          # 指定扫描根，默认仓库根

门禁（CI 与本地自查）：
  python scripts/size-governance.py -c docs --write-baseline docs/doc-governance/docs-baseline.json
  python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new
  # 退出码：0 通过（可有 warning）；1 违规；2 参数或文件错误
"""

from __future__ import annotations

import argparse
import datetime
import json
import os
import re
import sys
from pathlib import Path

WARN_KB = 30
RED_KB = 50
WARN_TOKENS = 9000
FAIL_TOKENS = 15000
TOKENS_PER_KB = 280

# 类别 -> (中文标签, 扩展名集合)。扩展名不在任何集合内的文件一律跳过
# （二进制、数据库、日志 .log/.jsonl、图片 .svg/.ico、运行产物 .tsbuildinfo 等）。
# tests 没有专属扩展名，由 classify 按文件名 .test./.spec. 从代码文件中划出。
CATEGORIES: dict[str, tuple[str, set[str]]] = {
    "docs": ("文档", {".md", ".mdx", ".txt"}),
    "code": ("代码", {".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"}),
    "tests": ("测试", set()),
    "config": ("配置/Schema", {".json", ".jsonc", ".yaml", ".yml", ".toml", ".prisma", ".sql", ".graphql", ".example"}),
    "fixtures": ("测试夹具", {".xml"}),
    "other": ("其它", {".css", ".scss", ".ps1", ".html"}),
}

TEST_NAME_RE = re.compile(r"\.(test|spec)\.[cm]?[tj]sx?$", re.IGNORECASE)

# 锁文件体积大但 Agent 几乎不会整读，按文件名排除
EXCLUDE_NAMES = {"bun.lock", "bun.lockb", "package-lock.json", "yarn.lock", "pnpm-lock.yaml", "deno.lock"}

# 依赖目录与构建产物整个跳过；.worktree 是整仓副本，不跳会全量重复统计
SKIP_DIRS = {"node_modules", ".git", ".worktree", ".next", "dist", "build", "out", "coverage", ".turbo", ".venv", "__pycache__"}
# 会话临时目录不是仓库内容，不入治理口径（其中残留的扫描输出会污染统计）
SKIP_DIR_PATHS = {".agent/tmp"}

EXT_TO_CAT: dict[str, str] = {
    ext: cat for cat, (_, exts) in CATEGORIES.items() for ext in exts
}


def classify(path: Path) -> str | None:
    """返回文件的类别键；不属于任何类别时返回 None。"""
    if path.name in EXCLUDE_NAMES:
        return None
    ext = path.suffix.lower()
    cat = EXT_TO_CAT.get(ext)
    if cat is None:
        return None
    if cat == "code" and TEST_NAME_RE.search(path.name):
        return "tests"
    return cat


def scan(root: Path, cats: set[str]) -> list[dict]:
    found: list[dict] = []
    for dirpath, dirnames, filenames in os.walk(root, onerror=lambda _e: None):
        rel_dir = Path(dirpath).relative_to(root)
        dirnames[:] = [
            d for d in dirnames
            if d not in SKIP_DIRS and (rel_dir / d).as_posix() not in SKIP_DIR_PATHS
        ]
        for name in filenames:
            path = Path(dirpath) / name
            cat = classify(path)
            if cat not in cats:
                continue
            try:
                data = path.read_bytes()
            except OSError:
                continue
            rel = path.relative_to(root).as_posix()
            non_ascii = len(data.translate(None, bytes(range(128))))
            found.append({
                "path": rel,
                "cat": cat,
                "bytes": len(data),
                "lines": data.count(b"\n"),
                "ascii": len(data) - non_ascii,
                "non_ascii": non_ascii,
            })
    found.sort(key=lambda item: (-item["bytes"], item["path"]))
    return found


def estimate_tokens(item: dict) -> int:
    """保守估算：ASCII 字节/4 + 其余字节按 3 字节/字折算后 ×1.1。与分词器无关，保证门禁可复现。"""
    return round(item["ascii"] / 4 + (item["non_ascii"] / 3) * 1.1)


def fmt_size(size: int) -> str:
    if size >= 1024 * 1024:
        return f"{size / 1024 / 1024:.2f} MB"
    if size >= 1024:
        return f"{size / 1024:.2f} KB"
    return f"{size} B"


def fmt_tokens(tokens: int) -> str:
    if tokens >= 1_000_000:
        return f"{tokens / 1_000_000:.2f}M"
    if tokens >= 1000:
        return f"{tokens / 1000:.1f}k"
    return str(tokens)


def load_exemptions(root: Path, file: Path | None) -> list[dict]:
    """加载豁免清单；默认根目录 .docs-size-exemptions.yml，不存在则视为空。"""
    target = file or (root / ".docs-size-exemptions.yml")
    if not target.exists():
        return []
    raw = target.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        data = yaml.safe_load(raw) or {}
        entries = list(data.get("exemptions") or [])
    except ImportError:
        entries = _parse_simple_yaml_exemptions(raw)
    for entry in entries:
        entry["_path_key"] = str(entry.get("path", "")).replace("\\", "/")
    return entries


def _parse_simple_yaml_exemptions(raw: str) -> list[dict]:
    """仅支持本仓库约定的扁平结构：exemptions: 列表，每项为标量键值对。"""
    entries: list[dict] = []
    current: dict | None = None
    in_list = False
    for line in raw.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped == "exemptions:":
            in_list = True
            continue
        if not in_list:
            continue
        if stripped.startswith("- "):
            if current is not None:
                entries.append(current)
            current = {}
            stripped = stripped[2:]
        if current is None:
            raise ValueError(f"豁免清单格式不符合约定（缺少 exemptions: 列表）: {stripped}")
        if ":" not in stripped:
            raise ValueError(f"豁免清单行无法解析: {stripped}")
        key, _, value = stripped.partition(":")
        value = value.strip().strip('"').strip("'")
        current[key.strip()] = None if value in ("", "null", "~") else value
    if current is not None:
        entries.append(current)
    return entries


def load_baseline(path: Path) -> dict:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data.get("files"), dict):
        raise ValueError(f"基线文件缺少 files 对象: {path}")
    return data


def over_thresholds(item: dict, warn_kb: int, fail_kb: int, warn_tokens: int, fail_tokens: int) -> str | None:
    """返回触发的档位：red / warn / None。字节与 token 双轨，先到先触发。"""
    tokens = item["tokens"]
    if item["bytes"] > fail_kb * 1024 or tokens > fail_tokens:
        return "red"
    if item["bytes"] > warn_kb * 1024 or tokens > warn_tokens:
        return "warn"
    return None


def run_gate(args: argparse.Namespace, files: list[dict], exemptions: list[dict]) -> int:
    exempt_map = {e["_path_key"]: e for e in exemptions}
    baseline = load_baseline(args.baseline)
    base_files: dict[str, int] = {k.replace("\\", "/"): int(v) for k, v in baseline["files"].items()}

    failures: list[str] = []
    warnings: list[str] = []
    infos: list[str] = []
    today = datetime.date.today()

    for item in files:
        zone = over_thresholds(item, args.warn, args.fail, args.warn_tokens, args.fail_tokens)
        if zone is None:
            continue
        exc = exempt_map.get(item["path"])
        if exc is not None:
            max_size = exc.get("max_size")
            if max_size is not None and item["bytes"] > int(max_size):
                failures.append(f"豁免超限: {item['path']} {fmt_size(item['bytes'])} > max_size {fmt_size(int(max_size))}")
            review_after = exc.get("review_after")
            if review_after:
                try:
                    if today > datetime.date.fromisoformat(str(review_after)):
                        warnings.append(f"豁免已过复审期({review_after}): {item['path']}，请重新评估")
                except ValueError:
                    warnings.append(f"豁免 review_after 无法解析({review_after}): {item['path']}")
            continue
        in_base = item["path"] in base_files
        if in_base:
            if item["bytes"] > base_files[item["path"]]:
                failures.append(
                    f"基线内文件增长: {item['path']} {fmt_size(item['bytes'])} > 登记 {fmt_size(base_files[item['path']])}"
                )
            elif zone == "red":
                infos.append(f"基线内存量红线(暂不阻塞): {item['path']} {fmt_size(item['bytes'])}")
        elif zone == "red":
            failures.append(f"新增红线文件: {item['path']} {fmt_size(item['bytes'])} / 约 {fmt_tokens(item['tokens'])} token")
        elif zone == "warn":
            msg = f"新增警戒区文件: {item['path']} {fmt_size(item['bytes'])} / 约 {fmt_tokens(item['tokens'])} token"
            (failures if args.fail_on_new else warnings).append(msg)

    for path in sorted(base_files):
        still = next((f for f in files if f["path"] == path), None)
        if still is None:
            infos.append(f"基线内文件已不存在(可移除): {path}")
        elif still["bytes"] < WARN_KB * 1024 and still["tokens"] <= WARN_TOKENS:
            infos.append(f"基线内文件已回到健康区(可移除): {path}")

    for line in infos:
        print(f"[info] {line}")
    for line in warnings:
        print(f"[warn] {line}")
    for line in failures:
        print(f"[fail] {line}")
    print()
    print(f"门禁口径: 警戒 {args.warn} KB / {args.warn_tokens} token，红线 {args.fail} KB / {args.fail_tokens} token（双轨先到先触发）")
    print(f"扫描 {len(files)} 个文件，基线 {len(base_files)} 条，豁免 {len(exempt_map)} 条")
    if failures:
        print(f"结果: FAIL（{len(failures)} 项违规）")
        return 1
    print(f"结果: {'PASS（含 warning）' if warnings else 'PASS'}")
    return 0


def write_baseline(args: argparse.Namespace, files: list[dict], exemptions: list[dict]) -> int:
    exempt_map = {e["_path_key"]: e for e in exemptions}
    entries = {
        item["path"]: item["bytes"]
        for item in files
        if item["path"] not in exempt_map
        and over_thresholds(item, args.warn, args.fail, args.warn_tokens, args.fail_tokens) is not None
    }
    payload = {
        "version": 1,
        "generated": datetime.date.today().isoformat(),
        "note": "存量超标登记，只减不增：条目只允许移除，bytes 只允许下调",
        "files": dict(sorted(entries.items())),
    }
    args.write_baseline.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"已写入基线 {args.write_baseline}（{len(entries)} 条）")
    return 0


def main() -> int:
    if sys.stdout.encoding and sys.stdout.encoding.lower() not in ("utf-8", "utf8"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    parser = argparse.ArgumentParser(description="按类别递归扫描 Agent 常读的文本类文件（超大文件治理）", add_help=True)
    parser.add_argument("-c", "--cat", nargs="+", default=None, metavar="CAT",
                        help=f"限定类别（空格或逗号分隔，可选：{' '.join(CATEGORIES)}），缺省扫描全部")
    parser.add_argument("--top", type=int, default=50, help="只显示前 N 个，0 表示全部（默认 50）")
    parser.add_argument("--path", type=Path, default=None, help="扫描根目录，默认仓库根（脚本目录的上一级）")
    parser.add_argument("--list-cats", action="store_true", help="列出类别定义后退出")
    parser.add_argument("--json", action="store_true", help="以 JSON 输出扫描结果")
    # 门禁参数
    parser.add_argument("--check", action="store_true", help="门禁模式：按阈值与基线检查，违规退出码 1")
    parser.add_argument("--warn", type=int, default=WARN_KB, help="警戒线（KB，默认 30）")
    parser.add_argument("--fail", type=int, default=RED_KB, help="红线（KB，默认 50）")
    parser.add_argument("--warn-tokens", type=int, default=WARN_TOKENS, help="警戒 token（默认 9000）")
    parser.add_argument("--fail-tokens", type=int, default=FAIL_TOKENS, help="红线 token（默认 15000）")
    parser.add_argument("--baseline", type=Path, default=None, help="基线文件（JSON）")
    parser.add_argument("--fail-on-new", action="store_true", help="新增文件进入警戒区即 fail（默认仅 warning）")
    parser.add_argument("--write-baseline", type=Path, default=None, help="把当前超标文件写入基线文件后退出")
    parser.add_argument("--exemptions", type=Path, default=None, help="豁免清单（默认根目录 .docs-size-exemptions.yml）")
    args = parser.parse_args()

    if args.list_cats:
        for key, (label, exts) in CATEGORIES.items():
            ext_note = " ".join(sorted(exts)) if exts else "（无专属扩展名，按文件名 .test./.spec. 判定）"
            print(f"{key:<10} {label:<10} {ext_note}")
        return 0

    if args.cat:
        requested: set[str] = set()
        for item in args.cat:
            requested.update(part for part in item.split(",") if part)
        unknown = requested - set(CATEGORIES)
        if unknown:
            valid = " ".join(CATEGORIES)
            print(f"未知类别: {' '.join(sorted(unknown))}（可用类别: {valid}）", file=sys.stderr)
            return 2
        cats = requested
    else:
        cats = set(CATEGORIES)

    root = (args.path or Path(__file__).resolve().parent.parent).resolve()
    if not root.is_dir():
        print(f"扫描根不存在或不是目录: {root}", file=sys.stderr)
        return 2

    files = scan(root, cats)
    for item in files:
        item["_root"] = str(root)
        item["tokens"] = estimate_tokens(item)

    if args.check or args.write_baseline:
        exemptions = load_exemptions(root, args.exemptions)
        if args.write_baseline:
            return write_baseline(args, files, exemptions)
        if args.baseline is None:
            print("--check 需要 --baseline 指向基线文件（先用 --write-baseline 生成）", file=sys.stderr)
            return 2
        if not args.baseline.exists():
            print(f"基线文件不存在: {args.baseline}（先用 --write-baseline 生成）", file=sys.stderr)
            return 2
        return run_gate(args, files, exemptions)

    if not files:
        print(f"在 {root} 下没有找到匹配类别 {' '.join(sorted(cats))} 的文件。")
        return 0

    if args.json:
        print(json.dumps({
            "root": str(root),
            "categories": sorted(cats),
            "count": len(files),
            "files": [{"path": f["path"], "cat": f["cat"], "bytes": f["bytes"], "lines": f["lines"], "tokens_est": f["tokens"]} for f in files],
        }, ensure_ascii=False, indent=2))
        return 0

    shown = files if args.top <= 0 else files[: args.top]
    label_width = max(len(CATEGORIES[c][0]) for c in cats)
    print(f"{'大小':>10}  {'估算token':>9}  {'行数':>6}  {'类别':<{label_width}}  路径")
    for item in shown:
        rel = item["path"]
        print(f"{fmt_size(item['bytes']):>10}  {fmt_tokens(item['tokens']):>9}  {item['lines']:>6}  {CATEGORIES[item['cat']][0]:<{label_width}}  {rel}")

    total = sum(f["bytes"] for f in files)
    red = [f for f in files if f["bytes"] > RED_KB * 1024 or f["tokens"] > FAIL_TOKENS]
    warn = [f for f in files if f not in red and (f["bytes"] > WARN_KB * 1024 or f["tokens"] > WARN_TOKENS)]
    print()
    print(f"扫描根: {root}")
    print(f"类别: {', '.join(sorted(cats))}   文件数: {len(files)}   总大小: {fmt_size(total)}   估算全量 token: {fmt_tokens(sum(f['tokens'] for f in files))}")
    print(f"红线(>{RED_KB}KB 或 >{FAIL_TOKENS} token): {len(red)} 个   警戒({WARN_KB}-{RED_KB}KB 或 {WARN_TOKENS}-{FAIL_TOKENS} token): {len(warn)} 个")
    if len(cats) > 1:
        print("分类汇总:")
        for cat in sorted(cats):
            group = [f for f in files if f["cat"] == cat]
            if group:
                cat_total = sum(f["bytes"] for f in group)
                cat_red = sum(1 for f in group if f["bytes"] > RED_KB * 1024 or f["tokens"] > FAIL_TOKENS)
                print(f"  {CATEGORIES[cat][0]:<10} {len(group):>4} 个  {fmt_size(cat_total):>9}  红线 {cat_red} 个")
    if 0 < args.top < len(files):
        print(f"仅显示前 {args.top} 个（共 {len(files)} 个），传 --top 0 查看全部")
    return 0


if __name__ == "__main__":
    sys.exit(main())
