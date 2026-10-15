# LantipScript — Improvement Plan

- **Status:** Approved 2026-10-15 · Phases 0–3 complete · Phase 4 next
- **Date:** 2026-10-15
- **Owner:** sawungrana

## Context

LantipScript works well on Apple Silicon (M2, 16 GB), but the Windows build is roughly
30x slower (observed: ~10 s on Mac vs ~5 min on an AMD Ryzen 7 5800U / 16 GB for the same
work). Investigation found the dominant cause is not the hardware but the inference
backend:

- `whisper-rs` (0.11.1) is compiled with **default features** (`src-tauri/Cargo.toml`),
  so there is **no GPU/BLAS backend on any platform**.
- On macOS, whisper.cpp enables the **Accelerate** framework by default, giving BLAS
  matmuls. This is why the Mac looks fine.
- On Windows there is no such default — it falls back to hand-written AVX2 CPU kernels.
- Additionally, the Whisper model is reloaded from disk on **every** transcription
  (`src-tauri/src/lib.rs`), and thread count defaults to `min(4, cores)`.

Upstream benchmarks on a same-family AMD Renoir CPU (Ryzen 7 4750U, large-v3-turbo)
show the swing clearly:

| Backend | 11 s clip | 35 s clip |
| --- | --- | --- |
| Vulkan (iGPU) | 4.14 s (2.7x RT) | 8.70 s (4.1x RT) |
| CPU only | 19.85 s (0.6x RT) | 40.18 s (0.9x RT) |

So the fix is to move to GPU backends (**Vulkan** on Windows/Linux, **Metal** on macOS)
by upgrading `whisper-rs` to 0.16, plus targeted CPU/UX hygiene.

## Goals (this cycle)

1. Fix Windows performance via **Vulkan** backend; accelerate macOS via **Metal**.
2. Upgrade `whisper-rs` 0.11.1 -> 0.16 (brings Vulkan/Metal features, DTW token
   timestamps, safe progress/abort callbacks).
3. Performance hygiene: cache the `WhisperContext`, set thread count, stream
   progress, support cancel.
4. UX: memoized transcript rows, auto-scroll to active segment, export error handling.
5. (Already done) millisecond timestamps in the UI/export + `[END]` marker.

## Non-goals / deferred

- **In-app model download.** Conflicts with the core promise ("100% offline, privacy
  first"). Possible future: a website that links to HuggingFace/URLs for models.
- **Model hot-loading / model picker UI.** Not a priority now; noted for later
  (see Backlog).
- **CUDA** (NVIDIA) and **CoreML/ANE** (Apple) backends.
- **Speaker diarization** (tinydiarize) and translation.

## Locked decisions

- **D1.** No in-app downloading of models. The shipped app stays fully offline. A
  future website may host links to model sources.
- **D2.** Model hot-loading is deferred; leave a note/backlog item.
- **D3.** Enable **Vulkan** (Windows) and **Metal** (macOS) backends this cycle.
  CPU remains the fallback.
- **D4.** GPU acceleration is **on by default** with automatic CPU fallback if GPU
  init fails, plus a settings toggle to force CPU for troubleshooting.
- **D5.** Timestamps shown/exported use `MM:SS.mmm`. Note: whisper.cpp times are
  quantized to 10 ms, so the `.mmm` will always end in `0` until/unless word-level
  DTW timestamps are enabled.
- **D6.** Default bundled model is **`ggml-large-v3-turbo-q5_0.bin`** (809M params,
  q5_0 quant, 547.4 MiB), replacing `small`. Download verified by SHA-256.
  **ATTENTION:** if Metal/Vulkan init fails, the CPU fallback now runs turbo-q5, which
  is *slower* than the old `small`. Watch for reports of "Windows is slow" from
  machines where GPU acceleration silently fell back to CPU; we need to surface the
  active backend (Phase 3) so this is visible rather than guessed.
- **D7.** Word-level timestamps (DTW token timestamps / `split_on_word`) are
  **deferred indefinitely**. The app's value includes minimalism; revisit only if
  users report segment granularity is too coarse. See "Deferred decisions".

## Deferred decisions

- **O2 — Word-level timestamps: deferred.** Would change segmentation (more, shorter
  segments) and slightly slow transcription, with no gain in displayed precision
  (10 ms ceiling). Revisit as an optional setting only on demand.

## Attention / watchlist

- **GPU init failure on real hardware.** If a user's machine cannot initialize
  Vulkan/Metal, the app falls back to CPU with the heavier turbo-q5 model -> slower
  than before. Detect and **show the active backend in the UI**; consider a startup
  warning. Re-evaluate bundling a small fallback model if reports appear.
- **Vulkan build paths.** `whisper-rs-sys` + CMake on Windows is sensitive to long
  paths; keep the short `CARGO_TARGET_DIR` workaround in CI.

## Platform / backend matrix

| Platform | Backend | Build requirement |
| --- | --- | --- |
| macOS (Apple Silicon) | Metal | Xcode toolchain (present on CI `macos-*` runners) |
| Windows x64 | Vulkan | LunarG Vulkan SDK at build time |
| Linux | Vulkan | Vulkan dev packages |
| Fallback (all) | CPU (AVX2/Accelerate) | none |

Cargo features must be selected per platform (Cargo has no per-target features), so CI
and local dev pass `--features metal` or `--features vulkan` explicitly. Keep a
CPU-only artifact available in case of driver issues.

## Phases

### Phase 0 — Prep (complete)
- Branch off `main` (`feat/gpu-backends`).
- ~~Record pre-change baseline timings~~ — **dropped** by decision (informal reports
  are enough; no fixed audio file). See `docs/benchmarks.md`.
- Write `docs/MODELS.md`: model names, sizes, source URLs, sha256.
- Fix `src-tauri/.gitignore` (model/sidecar binaries were not actually ignored).
- Download + SHA-256-verify the new default model (`ggml-large-v3-turbo-q5_0.bin`).

### Phase 1 — Engine upgrade (complete)
Done:
1. `whisper-rs` bumped to `0.16.0`; `metal` / `vulkan` Cargo features wired to
   `whisper-rs/metal` / `whisper-rs/vulkan` (no default features, so CPU-only builds
   still work without a feature flag).
2. API migrated: `WhisperContextParameters::use_gpu(true)` with CPU fallback on error,
   `set_n_threads(physical cores)` (`num_cpus`), `set_progress_callback_safe` emitting
   `transcribe-progress` (i32 percent), `set_abort_callback_safe` reading a shared
   `AtomicBool`; new `cancel_transcription` command (frontend wiring is Phase 3).
3. `WhisperContext` cached in managed `AppState` (`Arc<Mutex<Option<CachedModel>>>`),
   keyed by resolved model path.
4. Temp WAV cleanup via `TempFileGuard` (runs on the error path too).
5. Model path is the `WHISPER_MODEL_FILE` const (`ggml-large-v3-turbo-q5_0.bin`,
   resource-relative); whisper runs in `spawn_blocking`.
6. Word-level timestamps: **not in this cycle** (D7).
Verified: `cargo check` and `cargo check --features metal` pass. `--features vulkan`
needs a Vulkan-capable machine (Phase 2 CI).

### Phase 2 — CI / build backends (complete)
Done:
- `.github/workflows/build-windows.yml`:
  - Installs the LunarG Vulkan SDK **1.4.357.0** via the official silent installer
    (same pattern as llama.cpp CI), exports `VULKAN_SDK` + `PATH`.
  - Builds with `npm run tauri build -- --features vulkan`.
  - `CARGO_TARGET_DIR=C:\t` (short path) to dodge the `whisper-rs-sys` CMake
    long-path failure; upload paths updated accordingly.
  - Downloads `ggml-large-v3-turbo-q5_0.bin` and verifies its SHA-256 before build.
- `.github/workflows/build-macos.yml` (new): `macos-15` (arm64), downloads the same
  model (SHA-256 verified) + osxexperts FFmpeg 8.1 arm64 sidecar (SHA-256 verified,
  identical to the local dev binary), builds `--features metal`, uploads the `.dmg`.
- CPU-only fallback remains available: build/run without `--features` (documented in
  `README.md`).
Not verified here: actual GitHub Actions runs (needs a push + manual dispatch).

### Phase 3 — App integration (complete)
Done:
- `transcribe-progress` consumed via an event listener; loading area shows "Preparing
  audio..." until the first event, then a bordered progress bar + percent.
- Cancel button replaces "New Audio" while transcribing -> `cancel_transcription`;
  cancellation is silent (back to empty state, no error, no alert).
- **Engine visibility**: a settings gear in the header with a status dot
  (blue = unknown, green = GPU, amber = CPU) opens a popover showing the active
  backend ("Metal GPU" / "Vulkan GPU" / "CPU"), whether it is forced, whether the
  model is loaded yet, and the model name. This surfaces the silent CPU-fallback
  watchlist risk.
- **Force CPU mode** toggle in the popover, persisted in localStorage, pushed to Rust
  via `set_gpu_enabled` (clears the cached context so the next run reloads).
- Rust: `gpu_enabled` in `AppState`, `gpu_backend()` (metal/vulkan/None),
  `EngineStatus` + `get_engine_status` / `set_gpu_enabled` commands.
- Transcription failures now show a dismissible inline error card instead of `alert`.
- **Build fix:** `bundle.macOS.minimumSystemVersion` = `11.0` in `tauri.conf.json`.
  Tauri's default (10.13) is exported as `MACOSX_DEPLOYMENT_TARGET` during
  `tauri build`, which breaks whisper.cpp 0.16's `std::filesystem` usage
  (`'path' is unavailable: introduced in macOS 10.15`). Root cause of the first
  failed macOS CI run.

### Phase 4 — UX + precision
- Memoize transcript rows (`React.memo`, pass only `isActive`) and/or throttle
  `timeupdate` state updates to ~10 fps.
- Auto-scroll the active segment into view during playback.
- Surface export failures with an alert instead of silent console error.
- Window `minWidth`/`minHeight` in `tauri.conf.json`.
- Optional: SRT/VTT export.

## Verification

- `npx tsc --noEmit` and `npm run build` pass.
- `cargo check` with both `--features metal` (macOS) and `--features vulkan`.
- Manual: transcribe the same file on macOS before/after Metal; note wall-clock and
  real-time factor (in-app diagnostics / whisper timings).
- Windows: once the 5800U machine is available, compare CPU-only vs Vulkan using the
  same file; expect roughly the upstream Renoir ratio (~4x).
- Regression: language auto-detect (EN + Bahasa Indonesia) still works; export
  output still ends with `[MM:SS.mmm] [END]`.

## Risks

- Vulkan SDK adds CI setup time and a long-path gotcha; older GPUs/drivers may fail
  init -> mitigated by CPU fallback + toggle.
- **CPU-fallback regression:** with turbo-q5 bundled, a failed GPU init means slower
  transcription than the old `small`. Mitigation: surface the active backend in the UI
  and keep the watchlist item above. Escalation path: bundle a small fallback model.
- Upgrading whisper-rs (0.11 -> 0.16) may require small API adjustments; behavior of
  `use_gpu` default changes with the `_gpu` feature.
- Installer size grows slightly (turbo-q5 547 MiB vs small 465 MiB).

## Backlog (later)

- Model picker + hot-loading (cache keyed by path; `WhisperContext` is `Send + Sync`).
- Import a local `.bin` model file (offline-friendly alternative to downloads).
- Website linking to HuggingFace model URLs.
- CUDA and CoreML/ANE backends; tinydiarize speaker turns.
- In-app diagnostics/benchmark panel (system info, RTF).
- Diarization, SRT/VTT export, word-level timestamps UI.
