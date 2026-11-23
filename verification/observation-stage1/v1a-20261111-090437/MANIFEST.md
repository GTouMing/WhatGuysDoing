# V1A run manifest

- Approval: explicit user message `批准 V1A`; scope is [V1A authorization](<../../../docs/observation-verification.md>).
- Run ID: v1a-20261111-090437. Time label comes from the supplied Asia/Shanghai sample, not a measured performance timestamp.
- Resolved run directory: `E:/Projects/WhatGuysDoing/verification/observation-stage1/v1a-20261111-090437`.
- Parent checks: Windows directory attributes for `E:/`, `E:/Projects`, workspace and newly created run parents contain no ReparsePoint. New run and subdirectories were created only after collision checks.
- Java option-name checks: JAVA_TOOL_OPTIONS, JDK_JAVA_OPTIONS and _JAVA_OPTIONS are absent. No environment values or credentials were printed.
- Executables observed: Java SHA-256 `5fa6f5750f45d441b8375e7aa074e188334c2f9024171fd72f9add609782d7ad`; Javac SHA-256 `ad3843c1cca61c07594afc02b3618e5c610f48c0942ece5ab0acce76e4b44b11`. These are local fingerprints, not publisher-authenticated signatures.

## Approved test seams

These are the public boundaries already covered by the approved synthetic file tests, not a newly assumed product interface.

| Seam | Observable evidence | Does not establish |
| --- | --- | --- |
| Java 21 command-line runtime and compiler | Version, successful compilation and execution of isolated source | Any Minecraft/loader callback or performance |
| Java NIO Files / FileChannel on synthetic files | Force, atomic move, read failures and caller-visible file bytes | Product authorization semantics or hardware/directory crash durability |
| A self-created Java writer process controlled by its parent | Bytes left by process termination before/after atomic replacement | Power-loss ordering or revocation completion across a real restart |
| Non-initializing class inspection, only if provenance and dependencies permit | Fixed local classes can compile/load without initialization | Hook registration, dedicated-server linkage or final successful interactions |

Assertions use fixed literal synthetic JSON bytes. A deliberate unchanged-file control must fail before the actual atomic replacement is exercised; no product store or production record format is implemented. Subsequent slices are added only after the prior result is collected. Expected controls are labeled, not counted as successful behavior tests.

## Execution boundaries

No network, listeners, Minecraft, product main/entry point, real data, global configuration or existing cache writes. One top-level task at a time, at most two owned JVMs and 2 GiB combined heaps. All new Java temporary/profile output paths are inside this run. No persistent Gradle daemon; a requirement for any listener or untrusted/missing toolchain blocks that branch.

Evidence and sources are retained. Only this run's conclusively owned temporary objects may be removed. Commands, exit status, failed controls, source hashes and limits are recorded with actual results.
