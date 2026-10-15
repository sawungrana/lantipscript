# LantipScript — Improvement Plan

- **Status:** Approved 2026-10-15 · Phases 0–4 complete · **Phase 5 (SKU rollout) complete 2026-10-16** · awaiting CI dispatch + manual mac/Windows checks
- **Date:** 2026-10-16
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
  *Superseded for releases by S1–S4 (2026-10-16):* the Full SKU bundles this model;
  Lite/Express bundle `small-q5_1` / `tiny-q5_1`.
- **D7.** Word-level timestamps (DTW token timestamps / `split_on_word`) are
  **deferred indefinitely**. The app's value includes minimalism; revisit only if
  users report segment granularity is too coarse. See "Deferred decisions".

### SKU decisions (Phase 5, 2026-10-16)

- **S1.** Three release SKUs — **Full / Lite / Express** — same app name, identifier,
  and version; a SKU is just a different bundled model + artifact suffix.
- **S2.** Full = `ggml-large-v3-turbo-q5_0.bin` (547.4 MiB) — GPU machines, best accuracy.
- **S3.** Lite = `ggml-small-q5_1.bin` (181.3 MiB) — CPU-only / older machines; old
  default quality tier, ~3x turbo on CPU.
- **S4.** Express = `ggml-tiny-q5_1.bin` (30.7 MiB) — low bandwidth / draft passes,
  explicitly labeled lower accuracy (EN + Bahasa Indonesia + noisy audio).
- **S5.** All three model checksums come from `docs/MODELS.md`; no new models sourced.
- **S6.** No model picker, no in-app downloads (D1/D2 stand): exactly one model per install.
- **S7.** Runtime resolution replaces the compile-time const: `KNOWN_MODELS` registry in
  priority order turbo → small-q5_1 → tiny-q5_1; first file present in `resources/` wins;
  clear error if none. Deterministic for dev machines with several models.
- **S8.** `EngineStatus` gains `edition` ("Full" | "Lite" | "Express" | "Unknown");
  `model` stays the file name. Context cache remains keyed by path.
- **S9.** Engine popover shows `edition · model`; Express additionally shows a
  "draft quality" hint.
- **S10.** CPU-fallback nudge: after a successful transcription on Full with
  `using_gpu = false` and CPU not user-forced, show a one-time dismissible card
  (localStorage) suggesting Lite, linking to the Releases page. Suppressed on Lite,
  Express, and `forced_cpu`. Testable locally with a no-features CPU-only build.
- **S11.** CI builds once per OS (`tauri build --no-bundle`), then `tauri bundle` per SKU
  with exactly one SHA-256-verified model in `resources/` (macOS also asserts the
  finished `.app` contains exactly that `.bin`; Windows best-effort 7-Zip check).
- **S12.** Windows ships **NSIS only** (`--bundles nsis`); MSI is deferred as an
  enterprise extra. Fixes the 1.19 GB artifact (was MSI + NSIS in one upload).
- **S13.** Artifact naming: `lantipscript_<version>_<arch>_<sku>.dmg` /
  `lantipscript_<version>_x64_<sku>-setup.exe`; uploads are
  `LantipScript-<OS>-Installers`.

## Deferred decisions

- **O2 — Word-level timestamps: deferred.** Would change segmentation (more, shorter
  segments) and slightly slow transcription, with no gain in displayed precision
  (10 ms ceiling). Revisit as an optional setting only on demand.

## Attention / watchlist

- **GPU init failure on real hardware.** If a user's machine cannot initialize
  Vulkan/Metal, the app falls back to CPU with the heavier turbo-q5 model -> slower
  than before. **Mitigated (Phase 5):** the backend is shown in the UI (Phase 3), Lite
  exists as the CPU-first download, and a Full install that falls back to CPU suggests
  Lite once (S10). Remaining: verify the nudge on a real GPU-less Windows machine.
- **`tauri bundle` resource copying (Phase 5).** The per-SKU CI loop depends on the
  bundler re-copying `resources/` on every `tauri bundle` run; the macOS job asserts
  the finished `.app` contains exactly the expected model. **Verified locally
  (2026-10-16, macOS):** all three SKUs bundle exactly one, correct model. Two gotchas:
  `--bundles dmg` alone *deletes* the intermediate `.app` (CI asks for `app dmg` to
  keep it verifiable), and a failed DMG run can leave a stale `/Volumes/dmg.*` mount +
  `rw.*.dmg` behind (detach and retry; fresh CI runners are unaffected). Windows side
  still to confirm via a dispatched run.
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

### Phase 4 — UX + precision (complete)
Done:
- Transcript rows extracted into a module-level `TranscriptRow` wrapped in `React.memo`
  (props: `segment`, `index`, `isActive`, stable `useCallback` handlers);
  `updateSegmentText` now updates state immutably so only the edited row re-renders.
- `timeupdate` -> state throttled to ~10 fps (100 ms), plus an immediate flush on
  `seeking` so the highlight is accurate while scrubbing.
- Auto-scroll: during playback the active segment scrolls into view **only when out of
  view** (24 px margin, smooth, centered) so manual scrolling isn't fought.
- Export failures surface in the inline error card; the "invalid file type" `alert` also
  moved to the error card (no `alert` left in the app).
- Window `minWidth` / `minHeight` = 560 / 560 in `tauri.conf.json`.
- SRT/VTT export: **skipped for now** (backlog) — user decision 2026-10-15.
Verified: `npx tsc --noEmit` + `npm run build` pass. Manual macOS checklist for the
user: Metal dot green, progress + cancel, auto-scroll, edit + export, invalid-file card.

### Phase 5 — SKU rollout: Full / Lite / Express (complete 2026-10-16)
Done:
- Decisions S1–S13 (above) implement the Lite/Full-style SKU strategy over a model
  picker: smaller downloads for low-bandwidth / low-spec users, zero new UI surface
  beyond an edition label and the one-time nudge.
- Rust (`src-tauri/src/lib.rs`): `KNOWN_MODELS` registry (turbo → small-q5_1 →
  tiny-q5_1), `resolve_model()` with a clear missing-model error, `EngineStatus.edition`;
  `transcribe_audio` and `get_engine_status` both resolve through the registry. Context
  cache untouched (path-keyed).
- Frontend (`src/App.tsx`): popover shows `edition · model` (+ Express draft hint);
  one-time dismissible CPU-fallback nudge on Full that opens the Releases page via the
  opener plugin (`opener:default` already allows https).
- CI: both workflows now compile once (`tauri build --no-bundle`) and then run
  `tauri bundle` per SKU with a SHA-256-verified model in `resources/`; macOS asserts
  the finished `.app` contains exactly the expected `.bin`; Windows ships NSIS only
  (`--bundles nsis`) and best-effort-verifies the installer with 7-Zip. Artifacts:
  `lantipscript_<ver>_<arch>_<sku>` uploads.
- Docs: README download table + developer note, `docs/MODELS.md` three-SKU section with
  the Express accuracy caveat, `docs/release-notes-template.md`.
Verified: `cargo check` + `cargo check --features metal`, `npx tsc --noEmit`,
`npm run build`, both workflow YAMLs parse, `npm run tauri bundle -- --help` arg
forwarding, and the CI bash loop read/iteration. **Local macOS dry-run of the full CI
loop (2026-10-16):** one release build + per SKU `tauri bundle -- --bundles app dmg
--features metal` with a SHA-256-verified model in `resources/`; each `.app` contained
exactly the expected `.bin`; all three DMGs pass `hdiutil verify`; the Express DMG was
mounted and its contents confirmed. **Measured installer sizes: Full 538 MB, Lite
204 MB, Express 56 MB** (DMGs kept in the gitignored `artifacts/` for manual testing).
Not verified: actual CI runs (dispatch both), nudge on a real GPU-less Windows machine.

## Verification

- `npx tsc --noEmit` and `npm run build` pass.
- `cargo check` with both `--features metal` (macOS) and `--features vulkan`.
- Manual: transcribe the same file on macOS before/after Metal; note wall-clock and
  real-time factor (in-app diagnostics / whisper timings).
- Windows: once the 5800U machine is available, compare CPU-only vs Vulkan using the
  same file; expect roughly the upstream Renoir ratio (~4x).
- Regression: language auto-detect (EN + Bahasa Indonesia) still works; export
  output still ends with `[MM:SS.mmm] [END]`.
- SKU regression (Phase 5): each installer shows its own edition in the popover;
  Full on a CPU-only build shows the Lite nudge once; Lite/Express never show it.

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
  SKU variants were chosen instead for now (S1–S13); the registry/resolution added in
  Phase 5 is the same groundwork a picker would need.
- Import a local `.bin` model file (offline-friendly alternative to downloads).
- Website linking to HuggingFace model URLs.
- CUDA and CoreML/ANE backends; tinydiarize speaker turns.
- In-app diagnostics/benchmark panel (system info, RTF).
- Diarization, SRT/VTT export, word-level timestamps UI.
