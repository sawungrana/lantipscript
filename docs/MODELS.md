# Whisper Models Reference

Reference for maintainers (and a future public website) to the GGML models LantipScript
can use. Model files are **not committed to git**; CI downloads them into
`src-tauri/resources/`.

- **Source:** https://huggingface.co/ggerganov/whisper.cpp
- **URL pattern:** `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/<filename>`
- **Format:** whisper.cpp GGML (`ggml-*.bin`)
- **Multilingual models only** are listed below. `*.en` variants are English-only and
  unsuitable for LantipScript (needs English + Bahasa Indonesia).
- **Policy:** the app does **not** download models at runtime. A model is bundled in
  the installer; alternative models may be linked from a future website.

## Currently bundled

**Decision O1 (2026-10-15):** the bundled default is
`ggml-large-v3-turbo-q5_0.bin` (809M params, q5_0 quant, 547.4 MiB). It replaces
`ggml-small.bin` (465.0 MiB) — nearly the same installer size, much better accuracy.
Requires the GPU backends (Vulkan/Metal) to be fast; CPU-only fallback is slower than
the old `small` (see `docs/plan.md` Attention/watchlist).

| File | Size | SHA-256 |
| --- | --- | --- |
| `ggml-large-v3-turbo-q5_0.bin` | 574,041,195 B (547.4 MiB) | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` |

> Previously bundled: `ggml-small.bin` — 487,601,967 B (465.0 MiB) —
> `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`.
> Keep available as a fallback candidate (low-end / GPU-less machines) and for a
> future website.

## Multilingual models

| File | Params | Size | SHA-256 |
| --- | --- | --- | --- |
| `ggml-tiny.bin` | 39M | 77,691,713 B (74.1 MiB) | `be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21` |
| `ggml-tiny-q5_1.bin` | 39M | 32,152,673 B (30.7 MiB) | `818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7` |
| `ggml-base.bin` | 74M | 147,951,465 B (141.1 MiB) | `60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe` |
| `ggml-base-q5_1.bin` | 74M | 59,707,625 B (56.9 MiB) | `422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898` |
| `ggml-small.bin` | 244M | 487,601,967 B (465.0 MiB) | `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b` |
| `ggml-small-q5_1.bin` | 244M | 190,085,487 B (181.3 MiB) | `ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb` |
| `ggml-medium.bin` | 769M | 1,533,763,059 B (1.43 GiB) | `6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208` |
| `ggml-medium-q5_0.bin` | 769M | 539,212,467 B (514.2 MiB) | `19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f` |
| `ggml-large-v3.bin` | 1550M | 3,095,033,483 B (2.88 GiB) | `64d182b440b98d5203c4f9bd541544d84c605196c4f7b845dfa11fb23594d1e2` |
| `ggml-large-v3-q5_0.bin` | 1550M | 1,081,140,203 B (1.01 GiB) | `d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1` |
| `ggml-large-v3-turbo.bin` | 809M | 1,624,555,275 B (1.51 GiB) | `1fc70f774d38eb169993ac391eea357ef47c88757ef72ee5943879b7e8e2bc69` |
| `ggml-large-v3-turbo-q5_0.bin` | 809M | 574,041,195 B (547.4 MiB) | `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` |
| `ggml-large-v3-turbo-q8_0.bin` | 809M | 874,188,075 B (833.7 MiB) | `317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1` |

Sizes/SHA-256 taken from the HuggingFace API for `ggerganov/whisper.cpp`
(checked 2026-10-15). Quantized (`-q5_*`, `-q8_0`) builds trade a little accuracy for
size/speed.

## Why Whisper

Alternative local engines (e.g. NVIDIA Parakeet TDT 0.6B v3, Nemotron) are faster on
CPU at comparable accuracy, but they do **not** cover Bahasa Indonesia. LantipScript
requires English + Bahasa Indonesia, so Whisper (multilingual) remains the choice.

## Verifying a download

```sh
shasum -a 256 ggml-small.bin
```

```powershell
Get-FileHash .\ggml-small.bin -Algorithm SHA256
```

## Notes

- whisper timestamps are quantized to 10 ms; the app's `.mmm` display reflects that
  (always ends in `0`) unless word-level DTW timestamps are enabled.
- `large-v3-turbo` is a distilled `large-v3` (~8x faster decode) and is the accuracy
  sweet spot for GPU-accelerated machines.
