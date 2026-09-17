# Domain Docs

Engineering skills 探索 codebase 时，应如何消费这个 repo 的 domain documentation。

## Before exploring, read these

- repo 根目录的 **`CONTEXT.md`**。
- **`docs/adr/`** — 读取与你即将处理区域相关的 ADRs。

如果这些文件不存在，静默继续。不要标记缺失；不要提前建议创建。

## File structure

本项目采用 single-context layout：

```text
/
├── CONTEXT.md
├── docs/adr/
└── src/
```

## Use the glossary's vocabulary

当输出命名某个 domain concept 时（issue title、refactor proposal、hypothesis、test name），使用 `CONTEXT.md` 中定义的 term。不要漂移到 glossary 明确避免的 synonyms。

如果需要的概念还不在 glossary 中，应重新考虑该语言是否必要，或通过 domain-modeling 补充词汇。

## Flag ADR conflicts

如果输出与现有 ADR 矛盾，明确指出，而不是静默覆盖。
