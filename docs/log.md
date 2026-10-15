# Decision & Handover Log

Append-only log of decisions, changes, and handover notes for LantipScript.

## Attention / watchlist (living section)

- **GPU init failure -> silent CPU fallback + heavier model (2026-10-15).**
  Metal/Vulkan is on by default. If GPU init fails on a user's machine, we fall back
  to CPU, and the bundled model is now `large-v3-turbo-q5_0`, which is **slower on CPU
  than the old `small`**. This can look like "the app got slower" with no explanation.
  **UI now surfaces this (Phase 3):** the header gear shows the active backend with a
  status dot (green = GPU, amber = CPU) and Rust logs the backend name on model load.
  If reports still appear, consider bundling a small fallback model or prompting.
- **macOS deployment target (2026-10-15).** `tauri build` exports Tauri's
  `bundle.macOS.minimumSystemVersion` (default **10.13**) as `MACOSX_DEPLOYMENT_TARGET`.
  whisper.cpp 0.16 uses `std::filesystem` (needs >= 10.15), so the Tauri default breaks
  the Metal build. We pin `minimumSystemVersion: "11.0"` in `tauri.conf.json` — do not
  remove it. Affects `tauri build` (local + CI), not `tauri dev`.
- **Vulkan Windows build long paths.** `whisper-rs-sys` + CMake can fail on long paths;
  keep the short `CARGO_TARGET_DIR` workaround in CI.

---

## 2026-10-15

### Shipped (already in `main` working tree)

- `src/App.tsx`
  - `formatTime` now returns `MM:SS.mmm` (was `MM:SS`); used in transcript UI and export.
  - Export appends a blank line, the last segment's end timestamp, and `[END]`:
    `... \n\n[MM:SS.mmm] [END]`.
  - Timestamp column widened (`w-20`, tabular numerals, no-wrap) to fit milliseconds.
  - Verified with `npx tsc --noEmit`.

### Decisions

- **No in-app model download.** It conflicts with the app's core value (100% offline /
  privacy-first). Future possibility: an external website linking to HuggingFace model
  URLs. (See `docs/plan.md` D1.)
- **Model hot-loading deferred.** Not a priority now; recorded in the backlog. (D2.)
- **Backends this cycle: Vulkan (Windows) + Metal (macOS).** CPU stays as fallback.
  (D3.)
- **GPU on by default with CPU fallback + manual toggle.** (D4.)
- **No CUDA, no CoreML/ANE, no diarization this cycle.**
- **Root cause of Windows slowness identified** (not mainly hardware):
  `whisper-rs` built with default features => no GPU/BLAS backend. macOS gets
  Accelerate BLAS for free; Windows falls back to AVX2 CPU kernels. Reinforced by:
  per-run model reload, default `min(4, cores)` threads, possible Defender scanning.
  Observed ~30x gap (10 s Mac vs ~5 min Ryzen 7 5800U).
- **Model question answered:** `large-v3-turbo` (+ `q5_0` quant) is the current
  upgrade path. Alternative engines (NVIDIA Parakeet TDT v3, Nemotron) are faster on
  CPU but do not cover Bahasa Indonesia, so LantipScript stays on Whisper.
- **Open:** default bundled model (turbo-q5 vs keep small) and whether to enable
  word-level timestamps by default. See `docs/plan.md` O1/O2.

### What to know before picking this up (handover)

- **Repo:** Tauri v2 + React 19 + Vite + Tailwind v4. Key files:
  - `src/App.tsx` — all UI, waveform (wavesurfer.js), export, transcription calls.
  - `src-tauri/src/lib.rs` — `transcribe_audio` command: ffmpeg sidecar -> WAV ->
    whisper-rs.
  - `src-tauri/Cargo.toml` — currently `whisper-rs = "0.11.1"` (needs 0.16).
  - `.github/workflows/build-windows.yml` — Windows build (`npm run tauri build`).
- **Model + sidecar are not in git.** `src-tauri/resources/ggml-*.bin` and
  `src-tauri/bin/ffmpeg-*` are downloaded by CI / placed manually (see README).
- **Current whisper-rs version is old (0.11.1).** The upgrade to 0.16 is required for
  `metal`/`vulkan` features. API notes verified from docs:
  `WhisperContext` is `Send + Sync` (safe for managed state); `FullParams` has
  `set_n_threads`, `set_progress_callback_safe`, `set_abort_callback_safe`,
  `set_token_timestamps`, `set_split_on_word`.
- **macOS is currently CPU-only too** (no `metal` feature), even though it feels fast;
  Metal should speed it up further.
- **Timestamp ceiling:** whisper.cpp times are in 10 ms units, so `.mmm` always ends
  in `0`; the real precision upgrade is word-level/DTW token timestamps.
- **CI gotcha:** building `whisper-rs-sys` with `vulkan` on Windows can hit CMake
  long-path limits => use a short `CARGO_TARGET_DIR`.
- **Verification commands:** `npx tsc --noEmit`, `npm run build`,
  `cargo check --features <metal|vulkan>` (in `src-tauri`).
- **Windows benchmark still pending:** the 5800U test machine is in use; measure
  CPU-only vs Vulkan on the same file once available.

---

## 2026-10-15 — Phase 0 prep (branch `feat/gpu-backends`)

### Done

- Created branch `feat/gpu-backends` off `main`.
- **Fixed `src-tauri/.gitignore`.** Patterns were written as `src-tauri/resources/*.bin`
  and `src-tauri/bin/ffmpeg*`, but because the `.gitignore` lives *inside*
  `src-tauri/`, those paths resolved to `src-tauri/src-tauri/...` and matched nothing.
  The ~340 MB ffmpeg sidecar and ~465 MB model were showing up as untracked and at risk
  of being committed. Corrected to be relative (`resources/*.bin`, `bin/ffmpeg*`) and
  verified with `git check-ignore`. Also dropped a stale
  `src-tauri/target/.../*.dmg` line (already covered by `/target/`).
- Added `docs/MODELS.md`: multilingual models with exact sizes + SHA-256 (from the
  HuggingFace API), download URL pattern, checksum commands, and the "why Whisper"
  rationale (Parakeet/Nemotron lack Bahasa Indonesia).
- Added `docs/benchmarks.md`: measurement method (RTF), the informal pre-change
  baseline, target measurements, and upstream Renoir numbers for context.

### Still open

- Baseline numbers are informal only (no fixed audio file / duration / RTF yet).
  Blocked on the Windows test machine being free; will backfill `docs/benchmarks.md`.
- Decisions O1 (default bundled model) and O2 (word-level timestamps) from
  `docs/plan.md` are unresolved and gate Phase 1 defaults.
- Nothing committed yet on this branch (working tree changes only).

---

## 2026-10-15 — Phase 0 complete (decisions locked)

### Decisions

- **O1 resolved:** bundled default is now `ggml-large-v3-turbo-q5_0.bin` (809M params,
  q5_0 quant). Locked as **D6** in `docs/plan.md`.
- **O2 deferred indefinitely** (**D7**): no word-level timestamps this cycle. The app's
  value includes minimalism; revisit only if segment granularity is reported as coarse.
- **Baseline measurement dropped** by decision — informal reports only, no fixed audio
  file. `docs/benchmarks.md` keeps the informal numbers for context.

### Done

- Downloaded `ggml-large-v3-turbo-q5_0.bin` into `src-tauri/resources/`
  (git-ignored). Size **574,041,195 bytes**; SHA-256
  `394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2` **verified**
  (took several resumed attempts; HF CDN reset the connection a few times).
- `docs/plan.md`: added D6/D7, removed O1, moved O2 to "Deferred decisions", added an
  **Attention / watchlist** section (GPU init failure -> silent CPU fallback with a
  heavier model), updated risks and Phase 0 checklist.
- `docs/MODELS.md`: turbo-q5 marked as the bundled default; `ggml-small.bin` kept as a
  documented fallback candidate.
- `README.md`: dev setup now points at the turbo-q5 model file.
- Old `ggml-small.bin` left in `src-tauri/resources/` (git-ignored) for local
  comparison; it will no longer be shipped once the CI/model path changes land.

### Next (Phase 1 preview)

- `src-tauri/src/lib.rs` **still hardcodes `resources/ggml-small.bin`** and
  `src-tauri/Cargo.toml` still uses `whisper-rs 0.11.1`. CI also still downloads
  `small`. Those change in Phase 1 (engine) and Phase 2 (CI).
- Nothing committed yet on this branch.

---

## 2026-10-15 — Phase 1 complete (engine upgrade; branch `feat/gpu-backends`)

### Done

- `src-tauri/Cargo.toml`
  - `whisper-rs` `0.11.1` -> `0.16.0`; added `num_cpus = "1.16"`.
  - New `[features]`: `default = []`, `metal = ["whisper-rs/metal"]`,
    `vulkan = ["whisper-rs/vulkan"]`. No default features, so a plain `cargo check`
    is a valid CPU-only build; GPU backends are opt-in per platform at build time.
- `src-tauri/src/lib.rs` (rewritten)
  - Model path is now the `WHISPER_MODEL_FILE` const =
    `resources/ggml-large-v3-turbo-q5_0.bin` (resource-relative, resolved per run).
  - `WhisperContext` is cached in managed `AppState`
    (`Arc<Mutex<Option<CachedModel>>>`), keyed by resolved model path — no more
    ~574 MB reload per run. Logs `model loaded (GPU|CPU)` on first load.
  - GPU with fallback: if compiled with `metal`/`vulkan`, tries
    `WhisperContextParameters::use_gpu(true)` first; on error logs and retries with
    `use_gpu(false)`. Without a GPU feature, goes straight to CPU.
  - `set_n_threads(num_cpus::get_physical())` (was whisper default `min(4, cores)`).
  - `set_progress_callback_safe` emits `transcribe-progress` (i32 percent) on the
    Tauri app handle — no frontend listener yet (Phase 3).
  - `set_abort_callback_safe` reads a shared `Arc<AtomicBool>`; new
    `cancel_transcription` command sets it. Cancelled runs return the sentinel string
    `TRANSCRIPTION_CANCELLED` (frontend handling is Phase 3).
  - Temp WAV cleanup moved to a `TempFileGuard` (RAII) so it also runs on error paths.
  - Whisper inference runs in `tauri::async_runtime::spawn_blocking` (no longer blocks
    the async runtime); ffmpeg sidecar call stays async.
  - Kept `set_language(Some("auto"))` and `set_translate(false)`.
  - 0.16 API notes: `WhisperState::full_n_segments()` now returns `c_int` (not
    `Result`); iterate with `get_segment(i) -> Option<WhisperSegment>`;
    `start_timestamp()/end_timestamp()` are centiseconds (x10 for ms);
    `to_str_lossy()` for text.
- `README.md`: dev step 5 now shows `npm run tauri dev -- --features metal`
  (macOS) / `--features vulkan` (Windows/Linux); plain command = CPU-only.
- `docs/plan.md`: status -> "Phase 1 complete · Phase 2 next"; Phase 1 section marked
  complete with what shipped.

### Verified

- `cargo check` (CPU-only, no features) passes.
- `cargo check --features metal` passes on macOS (M2).
- `--features vulkan` not locally verifiable on macOS; covered by Phase 2 CI.
- `npx tsc --noEmit` (frontend untouched; command signature `{ inputPath }` unchanged).

### Not yet done / notes for next session

- CI still downloads `small` and builds without `--features vulkan` -> Phase 2.
- Frontend does not yet consume `transcribe-progress`/cancel or show the active
  backend -> Phase 3. Watchlist item stands (silent CPU fallback + heavier model).
- Nothing committed yet on this branch.

---

## 2026-10-15 — Phase 2 complete (CI backends; branch `feat/gpu-backends`)

### Done

- `.github/workflows/build-windows.yml` (rewritten):
  - **Vulkan SDK 1.4.357.0** installed via LunarG's official silent installer
    (`--accept-licenses --default-answer --confirm-command install`), same pattern
    llama.cpp CI uses; exports `VULKAN_SDK` (GITHUB_ENV) and its `bin` (GITHUB_PATH)
    so whisper.cpp's CMake finds the loader + `glslc`.
  - Build now `npm run tauri build -- --features vulkan` (npm forwards the flag;
    verified locally that the CLI receives `build --features vulkan`).
  - **Long-path workaround:** workflow-level `CARGO_TARGET_DIR: 'C:\t'`, artifact
    upload paths changed to `C:/t/release/bundle/...` with `if-no-files-found: error`
    so a silent path mismatch fails loudly.
  - Model download switched to `ggml-large-v3-turbo-q5_0.bin` **with SHA-256
    verification** (`394221...`) before the build.
- `.github/workflows/build-macos.yml` (**new**): `macos-15` (arm64, Apple Silicon),
  downloads the same model (SHA-256 verified, `curl --retry` for HF flakiness) and the
  osxexperts FFmpeg 8.1 arm64 sidecar (`ffmpeg81arm.zip`), renamed to
  `ffmpeg-aarch64-apple-darwin`; builds `--features metal`; uploads the `.dmg`.
  The FFmpeg zip's extracted binary hash matches the local dev sidecar **exactly**
  (`9a08d6...`), i.e. CI ships the same binary the dev machine uses.
- CPU-only fallback path stays documented (`README.md`: run without `--features`).

### Verified locally

- Both workflow YAMLs parse (ruby/psych).
- `npm run tauri build -- --features metal ...` arg forwarding confirmed (help output
  shows the flags reach the Tauri CLI).
- Model SHA-256 line passes against the local turbo-q5 file.
- FFmpeg download -> `unzip ffmpeg` -> SHA-256 check passes locally.
- LunarG installer URL (1.4.357.0) and osxexperts zip URL return HTTP 200.
- Windows runner image check: `windows-latest` (Server 2025 image) does **not**
  preinstall a Vulkan SDK -> the explicit install step is required.

### Still open / notes

- Untested until pushed + `workflow_dispatch`ed: the actual Actions runs (Vulkan SDK
  install time, CMake/Ninja build, `C:\t` path behavior through `tauri build`).
- `whisper-rs-sys` on Windows uses the runner's preinstalled Ninja automatically.
- Consider `Swatinem/rust-cache` later; CMake + whisper.cpp rebuild dominates CI time.
- Frontend still doesn't consume `transcribe-progress`/cancel; backend not shown in UI
  -> Phase 3 (watchlist stands).
- Nothing committed yet on this branch.

---

## 2026-10-15 — Phase 3 complete (app integration; `main`)

### Done

- Rust (`src-tauri/src/lib.rs`):
  - `AppState.gpu_enabled: Arc<AtomicBool>` (default true) read by
    `get_or_load_context`; `gpu_backend()` returns `Some("metal")`/`Some("vulkan")`/None.
  - New commands: `get_engine_status` (backend, using_gpu, loaded, forced_cpu, model)
    and `set_gpu_enabled` (clears the cached context so the next run reloads).
  - Backend name logged when the model loads.
- UI (`src/App.tsx`):
  - Progress bar consumes the `transcribe-progress` event; shows "Preparing audio..."
    until the first event, then a bordered bar + percent.
  - Cancel button replaces "New Audio" while transcribing -> silent reset via the
    `cancel_transcription` command (no error shown).
  - Header gear + status dot opens an engine popover: active backend, model, loaded
    state, and a "Force CPU mode" toggle persisted in `localStorage`
    (`lantipscript.gpuEnabled`).
  - Transcription errors render as a dismissible inline card instead of `alert`.

### Fixed: first macOS CI run failed (run 38766257410)

- Failed in `Build Tauri App (Metal)` after ~3 min:
  `ggml/src/ggml-backend-reg.cpp: 'path' is unavailable: introduced in macOS 10.15`.
- Root cause: `tauri build` (not `tauri dev`) exports `MACOSX_DEPLOYMENT_TARGET` =
  `bundle.macOS.minimumSystemVersion` (Tauri default **10.13**); whisper.cpp 0.16's
  new backend registry uses `std::filesystem` (requires >= 10.15).
- Reproduced locally: `cargo clean -p whisper-rs-sys` then
  `MACOSX_DEPLOYMENT_TARGET=10.13 cargo check --features metal` -> same errors.
- Fix: `src-tauri/tauri.conf.json` -> `"macOS": { "minimumSystemVersion": "11.0" }`.
- Verified: `npm run tauri build -- --no-bundle --features metal` succeeds with a fresh
  whisper.cpp build; `cargo check`, `cargo check --features metal`, `npx tsc --noEmit`
  all pass.

### Still open / notes

- macOS CI re-dispatched after the fix to confirm green.
- Windows artifact (run 38755168943) predates Phase 3; final Windows + macOS artifacts
  will be rebuilt after Phase 4.
- Runtime check on the Windows 5800U laptop still pending (Vulkan vs CPU speed) — the
  engine popover now makes the active backend visible there.

---

## 2026-10-15 — Phase 4 complete (UX + precision; `main`)

Note: macOS CI run 38767813523 went green (6m22s) after the deployment-target fix;
`LantipScript-macOS-Installer` (535 MB) uploaded.

### Done

- `TranscriptRow` extracted to module level and wrapped in `React.memo`;
  `updateSegmentText` rewritten as an immutable functional update
  (`prev.map(...)`) behind `useCallback`, so playback re-renders don't touch static
  rows and editing re-renders only that row.
- `timeupdate` -> state throttled to ~10 fps (100 ms); `seeking` flushes immediately so
  the highlight stays accurate while scrubbing.
- Auto-scroll during playback to the active segment, **only when out of view** (24 px
  margin, smooth, centered) — avoids fighting manual scrolling.
- `handleExport` catch -> inline error card; the invalid-file `alert` also moved to the
  error card. No `alert` left in the app.
- `tauri.conf.json` window: `minWidth: 560`, `minHeight: 560`.
- SRT/VTT export: skipped (backlog).
- Verified: `npx tsc --noEmit` and `npm run build` pass.

### Still open / notes

- Manual macOS checklist pending (user): Metal dot green, progress + cancel,
  auto-scroll, edit + export, invalid-file card, Force CPU round-trip.
- Windows runtime check on the 5800U laptop deferred by user; final artifacts for both
  platforms re-dispatched after this commit.
