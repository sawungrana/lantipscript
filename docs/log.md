# Decision & Handover Log

Append-only log of decisions, changes, and handover notes for LantipScript.

## Attention / watchlist (living section)

- **GPU init failure -> silent CPU fallback + heavier model (2026-10-15).**
  Metal/Vulkan is on by default. If GPU init fails on a user's machine, we fall back
  to CPU, and the bundled model is now `large-v3-turbo-q5_0`, which is **slower on CPU
  than the old `small`**. This can look like "the app got slower" with no explanation.
  **UI now surfaces this (Phase 3):** the header gear shows the active backend with a
  status dot (green = GPU, amber = CPU) and Rust logs the backend name on model load.
  **Mitigated (Phase 5, 2026-10-16):** Lite/Express SKUs exist as CPU-first downloads,
  and a Full install whose GPU init fell back to CPU shows a one-time nudge toward Lite
  (plan S10). Remaining: verify the nudge on a real GPU-less Windows machine.
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

---

## 2026-10-16 — Phase 5: SKU rollout (Full / Lite / Express)

### Decisions

- **S1–S13 locked in `docs/plan.md`.** One app, three release SKUs that differ only by
  the bundled Whisper model: Full = `large-v3-turbo-q5_0`, Lite = `small-q5_1`,
  Express = `tiny-q5_1`. Rationale: 452 MB+ downloads are heavy for the target audience
  (Indonesian researchers, sometimes low bandwidth), a dual-model installer would make
  *every* download bigger (~750 MB), and model import from a website adds user friction.
- **Express is positioned as "draft"**, not "recommended": tiny's accuracy is markedly
  lower, especially for Bahasa Indonesia and noisy interview audio (S4).
- **No model picker / no runtime downloads** (D1/D2 stand) — resolution is by registry
  priority in the bundled resources.
- **Windows ships NSIS only** (S12): the old 1.19 GB artifact was MSI + NSIS in one
  upload; macOS was 535 MB with a single .dmg.

### Done

- `src-tauri/src/lib.rs`
  - `KNOWN_MODELS` registry: (file, edition) in priority order turbo → small-q5_1 →
    tiny-q5_1; `edition_for()`; `resolve_model()` scans the bundled resource dir and
    errors clearly when no known model is present.
  - `EngineStatus.edition` added; `get_engine_status` prefers the loaded (cached) model
    and falls back to the bundled SKU file; `transcribe_audio` resolves through the
    registry (the old `WHISPER_MODEL_FILE` const is gone). Context cache unchanged.
- `src/App.tsx`
  - Popover shows `edition · model`; Express shows a "Draft quality" hint.
  - One-time CPU-fallback nudge on Full: after a *successful* transcription with
    `using_gpu = false`, `forced_cpu = false`, and no dismissal flag
    (`lantipscript.liteNudgeDismissed`), an amber card suggests Lite and opens the
    Releases page via `@tauri-apps/plugin-opener` (`opener:default` already allows
    https). Suppressed on Lite/Express and with forced CPU.
- `.github/workflows/build-macos.yml`, `build-windows.yml`
  - Compile once (`tauri build --no-bundle --features metal|vulkan`), then per SKU:
    clean `resources/`, download model, SHA-256 verify, `tauri bundle` (dmg / nsis),
    copy to `artifacts/lantipscript_<ver>_<arch>_<sku>`.
  - macOS asserts the finished `.app` contains exactly the expected `.bin`; Windows
    best-effort-verifies the NSIS installer's contents with 7-Zip (skips if 7-Zip is
    unavailable) and no longer produces/uploads MSI.
  - Upload names are now `LantipScript-<OS>-Installers` (plural).
- Docs: README download table (+ Express caveat, dev note on model resolution),
  `docs/MODELS.md` "Currently bundled (one model per SKU)" with all three checksums,
  plan.md S1–S13 + Phase 5 + updated watchlist, new
  `docs/release-notes-template.md`.

### Verified

- `cargo check` (CPU-only) and `cargo check --features metal` pass.
- `npx tsc --noEmit` and `npm run build` pass.
- Both workflow YAMLs parse (ruby/psych); `npm run tauri bundle -- --help` confirms the
  `--bundles` arg forwarding used in CI; the CI bash read/loop logic was dry-run
  locally.
- Note: `cargo check --features metal` initially failed with the familiar
  `std::filesystem`/10.15 errors from a stale **Phase 3 repro** CMake cache;
  `cargo clean -p whisper-rs-sys` fixed it (not a regression).
- **Local macOS dry-run of the full SKU pipeline** (same commands as CI): release build
  `--no-bundle --features metal` (29 s incremental), then per SKU — model copied +
  SHA-256 verified in `resources/`, `tauri bundle -- --bundles app dmg --features metal`,
  assert `.app` contains exactly the expected `.bin`, copy DMG to `artifacts/`. All three
  passed; `hdiutil verify` validates all three DMGs and the Express DMG was mounted to
  confirm the shipped contents. **Measured sizes: Full 538 MB, Lite 204 MB, Express
  56 MB.** Dev resources (turbo-q5 + `ggml-small.bin`) restored afterwards.
- **Gotcha found during the dry-run:** `tauri bundle --bundles dmg` (dmg only) deletes
  the intermediate `.app` after building the DMG, so post-bundle `.app` verification is
  impossible — the workflow now uses `--bundles app dmg` to keep it. A failed DMG run
  can also leave a stale `/Volumes/dmg.*` mount + `rw.*.dmg`; detach/remove and retry
  (fresh CI runners are unaffected). Exact model + SHA checks in `resources/` remain as
  the pre-bundle guard on Windows. Also: `tauri build` fails if `resources/*` matches
  nothing (`glob pattern resources/* not found`) — keep one model in `resources/`
  before compiling (CI always downloads one first; local devs: download one per README).

### Version 1.0.0 — first stable release

- Version bumped 0.1.0 → 1.0.0 in `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`,
  and `package.json` (+ lockfiles). Rationale: engine visibility, progress/cancel, UX
  polish, and the SKU strategy complete the first stable feature set. CI derives
  artifact names from `tauri.conf.json`, so no workflow changes were needed.
- Added `src-tauri/examples/transcribe.rs` — dev-only harness that runs the same
  pipeline as the app (bundled ffmpeg sidecar conversion, wav reading, and whisper
  params: greedy `best_of: 1`, auto language, physical threads, GPU when compiled with
  `metal`/`vulkan`). Usage:
  `cd src-tauri && cargo run --release --example transcribe --features metal -- <audio> [model] [--gpu|--cpu]`

### Real-audio verification (`src/assets/test_audio.mp3`, 8m18s, English, M2 Metal)

| SKU | Model | Wall clock | RTF | Segments |
| --- | --- | --- | --- | --- |
| Full | turbo-q5_0 | 26.5 s | 18.8x | 224 |
| Lite | small-q5_1 | 10.7 s | 46.6x | 31 |
| Express | tiny-q5_1 | 3.5 s | 144.1x | 49 |

- Quality spot-check (the "letter and ... of flowers" + "rambling" passage):
  - **Lite** near-verbatim: "a small gesture of a letter and a bouquet of flowers",
    "rambling".
  - **Full** misheard: "a bucket of flowers", "rumbling", and fragmented into 224
    mostly 1–2 s segments.
  - **Express** garbled: "smoldier", "bookhead of flowers", "robbing" — confirms the
    draft-only positioning.
- **Observation:** on this one sample the Lite model beat Full on speed *and* text.
  One sample is not a verdict (upstream benchmarks favor turbo), but worth a
  follow-up: try `set_no_context(true)` and/or longer segment merging for Full, and
  re-test across more recordings (incl. Bahasa Indonesia). If it holds, revisit which
  model the quality SKU should ship.
- Local 1.0.0 DMGs rebuilt in the gitignored `artifacts/` for install testing.

### Repo polish — README as the front door

- Rewrote `README.md` in a quieter register: the privacy story is carried by
  behavior, not adjectives (no model screen, no model downloads, nothing to leak).
- Logo (already tracked in `src/assets/`) now heads the README; the screenshot moved
  from the gitignored `dist/` to `src/assets/lantipscript_screenshot.png` so GitHub
  renders it.
- Download guidance is one table keyed to "Choose it when", with `Full if the machine
  is new, Lite if it isn't` as the shorthand. Home: lantip.space/lantipscript.
- `docs/release-notes-template.md` brought into the same voice; UI copy in `App.tsx`
  is the remaining user-facing surface to review.

### Still open / notes

- Dispatch both workflows and inspect: macOS loop is locally proven; the open items are
  the actual Actions runs and the Windows NSIS/7-Zip check.
- Manual M2 checks: popover shows "Full · large-v3-turbo-q5_0"; run a CPU-only dev build
  (`npm run tauri dev` without `--features`) to see the nudge fire once; dismissal
  persists; Lite/Express installs never show it.
- Windows 5800U: Vulkan vs CPU comparison still pending; the nudge needs a real
  GPU-less machine to confirm.
- If MSI is ever needed (enterprise/GPO), add it as a separate artifact (S12).
- Real-audio follow-up above: compare Full vs Lite across more files (Bahasa
  Indonesia too) and try `set_no_context(true)` for Full's segmentation.
