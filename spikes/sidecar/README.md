# Sidecar spike

Throwaway spike for SPEC.md "First things to verify" items 1 (auth) and 3 (Bun-compiled sidecar). Findings are recorded in [SPEC.md](../../SPEC.md#spike-findings).

Speaks one JSON object per line over stdio:

```bash
echo '{"type":"auth"}' | bun index.ts
echo '{"type":"prompt","text":"Say hello in five words."}' | bun index.ts
```

```bash
bun run build
```

`bun run build` writes `dist/tinkr-sidecar.exe` (Windows x64 only for now).
