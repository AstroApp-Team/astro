# Picking the view agent's model on the AI Gateway free tier

Researched 2026-08-24, when `VIEW_MODEL_ID` moved from `openai/gpt-oss-120b` to
`moonshotai/kimi-k2.7-code`.

**Superseded 2026-10-30:** the account now has paid credits and `VIEW_MODEL_ID`
is `deepseek/deepseek-v4.1-flash-1017`. This page stays as the record of the
free-tier choice, and is the fallback if the credits run out.

## What the free tier actually gates

`https://vercel.com/ai-gateway/models` carries a per-model `availableToFreeTier`
flag in its page payload (the same payload holds Vercel's measured p50/avg/p95
time-to-first-token and p50 tok/s — the rendered table shows only some of it).
352 models, 157 of them chat models the free tier may call.

Every frontier coder is on the wrong side of that flag: Claude Opus 5 /
Sonnet 5 / Fable 5, GPT-5.6 (Luna/Sol/Terra), GPT-5.3-codex, Gemini 3.6/3.7,
GLM 5.x, Kimi K3, Grok 4.5, DeepSeek V4, Qwen3.8. The choice is made among
second-tier models, and `availableToFreeTier` means "the Hobby plan may call
it", not "free of charge" — `openai/gpt-5` and `o3` are on the list at full
price.

## The field

Capability columns are independent where such a number exists (Artificial
Analysis Intelligence Index, SWE-rebench, Vals AI) and vendor-reported
otherwise. They are _different benchmarks_ — read down a column, never across.

| model                        | rel.     | AA idx | SWE-rebench | other coding                                       | tok/s | TTFT p50/avg/p95 ms | $/M in→out | ctx   |
| ---------------------------- | -------- | ------ | ----------- | -------------------------------------------------- | ----- | ------------------- | ---------- | ----- |
| moonshotai/kimi-k2.7-code    | Jun 12   | 43     | –           | Vals SWE-bench 78.2 (#1 open), TB2.1 67.0          | 186   | 505/649/1365        | 0.74→3.50  | 262k  |
| minimax/minimax-m3           | May 31   | 45     | 47.2        | TB2.1 66.0, SWE-Pro 59.0                           | 234   | 928/958/1392        | 0.24→0.96  | 1M    |
| tencent/hy3                  | Jul 6    | 42     | –           | TB2.1 71.7, SWE-Pro 57.9, SWE-ML 75.8              | 72    | 1066/1433/3049      | 0.13→0.52  | 262k  |
| xiaomi/mimo-v2.5-pro         | Apr 22   | –      | 46.5        | –                                                  | 64    | 389/468/915         | 0.30→0.61  | 1.05M |
| inclusionai/ling-3.0-flash   | Aug 6    | 38     | –           | SWE-Pro 56.6 (5.1B active)                         | 337   | 858/863/1241        | 0.06→0.18  | 256k  |
| kwaipilot/kat-coder-pro-v2.5 | Jul 10   | –      | –           | SWE-Pro 65.2 (vendor scaffold)                     | 128   | 900/1030/1754       | 0.74→2.96  | 256k  |
| poolside/laguna-s-2.1        | Jul 20   | –      | –           | TB2.1 70.2, SWE-ML 78.5, DeepSWE 40.4 (all vendor) | 105   | 936/2299/5836       | 0.10→0.20  | 1M    |
| zai/glm-4.7                  | Dec 22   | 34     | –           | SWE-V 73.8 (vendor), TB2.0 41                      | 180   | 129/180/374         | 2.25→2.75  | 205k  |
| stepfun/step-3.7-flash       | Jul 31   | 31     | –           | SWE-Pro 56.3, TB2.1 59.6                           | n/a   | n/a                 | 0.20→1.15  | 1M    |
| openai/gpt-oss-120b _(was)_  | Aug 2025 | 24     | –           | –                                                  | 476   | 188/191/266         | 0.35→0.75  | 131k  |

## Why Kimi K2.7 Code

It is the only code-specialised model left on the free tier with a third-party
score, and that score is the best of the open weights. Its Intelligence Index
of 43 against MiniMax M3's 45 is inside noise; its TTFT is not (505 p50 vs 928),
and TTFT is paid on every step of `buildView`'s loop.

The dissent worth knowing: poolside's DeepSWE table puts K2.7 Code at 31.0,
below their own Laguna S 2.1 at 40.4. That table is on the blog post launching
Laguna. Vals AI has no stake, so it gets the weight — and the same discount
applies to _every_ Laguna number here, none of which has an independent
counterpart.

## Judge speed by the tail, not the median

TTFT p50 is misleading for an agent loop; the p95 is what the user feels. On
the free tier the two diverge hard:

- `zai/glm-4.7-flash` — 141 p50, **3272 p95** (looks like the speed winner, isn't)
- `minimax/minimax-m2.7` — 612 p50, **5839 p95**
- `poolside/laguna-s-2.1` — 936 p50, **5836 p95**

versus the tight ones: `zai/glm-4.7` (129/374), `xai/grok-build-0.1` (358/878),
`moonshotai/kimi-k2.7-code` (505/1365).

## Two numbers that disagree with themselves

- Artificial Analysis measures Kimi K2.7 Code at 49 tok/s and 2.9s TTFT; Vercel
  measures 186 tok/s and 505ms. AA averages a provider mix, Vercel measures the
  Gateway route. Only the second one is the path this Worker takes.
- GLM-4.7's headline 73.8% SWE-bench Verified is Z.ai's own; its independent
  Intelligence Index of 34 does not support it. That gap is why it lost here
  despite the best TTFT on the free tier.

## The catch to watch

`gpt-oss-120b` allowed 131k output tokens; Kimi K2.7 Code allows 32k. A single
`write_view` of a page near `MAX_VIEW_HTML_BYTES` (96 KB) is close to that
ceiling. A truncated write fails `checkViewHtml` and the loop retries, so it
degrades rather than breaks — but if truncation shows up in practice, the fix
is smaller `edit_view` calls, not a bigger cap.

## Sources

- [Vercel AI Gateway — models](https://vercel.com/ai-gateway/models) and [leaderboards](https://vercel.com/ai-gateway/leaderboards/models)
- [Vals AI — Kimi K2.7 Code](https://www.vals.ai/models/kimi_kimi-k2.7-code)
- [Artificial Analysis](https://artificialanalysis.ai/) — [Kimi K2.7 Code vs MiniMax-M3](https://artificialanalysis.ai/models/comparisons/kimi-k2-7-code-vs-minimax-m3), [GPT-OSS-120B](https://artificialanalysis.ai/models/gpt-oss-120b), [Hy3](https://artificialanalysis.ai/models/hy3), [GLM-4.7](https://artificialanalysis.ai/models/glm-4-7), [Step 3.7 Flash](https://artificialanalysis.ai/models/step-3-7-flash), [Ling 3.0 Flash](https://artificialanalysis.ai/models/ling-3-0-flash)
- [SWE-rebench](https://swe-rebench.com/)
- [Poolside — Introducing Laguna S 2.1](https://poolside.ai/blog/introducing-laguna-s-2-1) (Terminal-Bench 2.1 / DeepSWE / SWE-Bench Pro tables)
- [MiniMax — M3](https://www.minimax.io/blog/minimax-m3), [MarkTechPost — KAT-Coder-V2.5](https://www.marktechpost.com/2026/07/26/kwaikat-team-releases-kat-coder-v2-5-an-agentic-coding-model-trained-on-100000-verifiable-repository-environments/), [MarkTechPost — Tencent Hy3](https://www.marktechpost.com/2026/07/06/tencent-releases-hy3-open-295b-moe-model/)
