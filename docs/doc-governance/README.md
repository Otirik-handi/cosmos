# 文档治理工件目录

本目录存放文档大小治理(`docs/proposals/oversized-doc-splitting-v1.md`)的长期工件:

- `scan-YYYY-MM-DD.md`:全仓扫描报告(证据快照,按日期留存);
- `.docs-size-exemptions.yml`:豁免清单(path/reason/owner/review_after/max_size),Task 实施时落地;
- 基线文件:存量超标文档清单,只减不增,Task 实施时落地。

扫描工具:`scripts/size-governance.py`(由根目录 findmd.ps1 经 find-large-files 演进而来,支持按类别扫描与 CI 门禁)。

治理类任务(拆分实施等)的过程记录在 `.agents/tasks/governance/`(G{NN} 独立编号,章程与索引见其 README)。
