use hound;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_shell::ShellExt;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

/// Bundled model path, relative to the Tauri resource directory.
const WHISPER_MODEL_FILE: &str = "resources/ggml-large-v3-turbo-q5_0.bin";

/// Returned to the frontend when the user cancels a transcription.
const CANCELLED_ERROR: &str = "TRANSCRIPTION_CANCELLED";

#[derive(serde::Serialize)]
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

// The context is expensive to load, so it is cached across transcriptions
// and only reloaded if the resolved model path changes.
struct CachedModel {
    path: PathBuf,
    context: Arc<WhisperContext>,
    #[allow(dead_code)] // Surfaced in the UI in a later phase.
    using_gpu: bool,
}

#[derive(Clone, Default)]
struct AppState {
    model: Arc<Mutex<Option<CachedModel>>>,
    cancel: Arc<AtomicBool>,
}

// Deletes the temp WAV even when transcription exits early via `?`.
struct TempFileGuard(PathBuf);

impl Drop for TempFileGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[cfg(any(feature = "metal", feature = "vulkan"))]
fn gpu_compiled() -> bool {
    true
}

#[cfg(not(any(feature = "metal", feature = "vulkan")))]
fn gpu_compiled() -> bool {
    false
}

fn num_threads() -> i32 {
    num_cpus::get_physical().max(1) as i32
}

fn load_context(model_path: &Path) -> Result<(WhisperContext, bool), String> {
    if gpu_compiled() {
        let mut gpu_params = WhisperContextParameters::default();
        gpu_params.use_gpu(true);
        match WhisperContext::new_with_params(model_path, gpu_params) {
            Ok(context) => return Ok((context, true)),
            Err(e) => {
                eprintln!("[lantipscript] GPU init failed ({e}); falling back to CPU");
            }
        }
    }

    let mut cpu_params = WhisperContextParameters::default();
    cpu_params.use_gpu(false);
    WhisperContext::new_with_params(model_path, cpu_params)
        .map(|context| (context, false))
        .map_err(|e| format!("Failed to load Whisper model: {e}"))
}

fn get_or_load_context(state: &AppState, model_path: &Path) -> Result<Arc<WhisperContext>, String> {
    let mut cache = state
        .model
        .lock()
        .map_err(|_| "Model cache lock poisoned".to_string())?;

    if let Some(cached) = cache.as_ref() {
        if cached.path == model_path {
            return Ok(cached.context.clone());
        }
    }

    let (context, using_gpu) = load_context(model_path)?;
    eprintln!(
        "[lantipscript] model loaded ({})",
        if using_gpu { "GPU" } else { "CPU" }
    );

    let context = Arc::new(context);
    *cache = Some(CachedModel {
        path: model_path.to_path_buf(),
        context: context.clone(),
        using_gpu,
    });

    Ok(context)
}

fn read_wav_samples(path: &Path) -> Result<Vec<f32>, String> {
    let mut reader =
        hound::WavReader::open(path).map_err(|e| format!("Failed to open wav file: {e}"))?;

    reader
        .samples::<i16>()
        .map(|sample| sample.map(|s| s as f32 / 32768.0))
        .collect::<Result<Vec<f32>, _>>()
        .map_err(|e| format!("Failed to read wav samples: {e}"))
}

fn run_whisper(
    state: &AppState,
    model_path: &Path,
    audio_data: Vec<f32>,
    app: tauri::AppHandle,
) -> Result<Vec<TranscriptSegment>, String> {
    let context = get_or_load_context(state, model_path)?;

    let mut whisper_state = context
        .create_state()
        .map_err(|e| format!("Failed to create Whisper state: {e}"))?;

    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(num_threads());
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    // Auto-detect Bahasa Indonesia or English, transcribe (never translate).
    params.set_language(Some("auto"));
    params.set_translate(false);

    let cancel_flag = state.cancel.clone();
    params.set_abort_callback_safe(move || cancel_flag.load(Ordering::Relaxed));

    let progress_app = app.clone();
    params.set_progress_callback_safe(move |progress| {
        let _ = progress_app.emit("transcribe-progress", progress);
    });

    whisper_state
        .full(params, &audio_data)
        .map_err(|e| format!("Transcription failed: {e}"))?;

    if state.cancel.load(Ordering::Relaxed) {
        return Err(CANCELLED_ERROR.to_string());
    }

    let num_segments = whisper_state.full_n_segments();
    let mut segments = Vec::with_capacity(num_segments.max(0) as usize);

    for i in 0..num_segments {
        let Some(segment) = whisper_state.get_segment(i) else {
            continue;
        };

        let text = segment
            .to_str_lossy()
            .map(|s| s.trim().to_string())
            .unwrap_or_default();

        if text.is_empty() {
            continue;
        }

        segments.push(TranscriptSegment {
            // Whisper timestamps are centiseconds (10 ms units).
            start_ms: segment.start_timestamp() * 10,
            end_ms: segment.end_timestamp() * 10,
            text,
        });
    }

    Ok(segments)
}

// This is our main transcription command that React will call
#[tauri::command]
async fn transcribe_audio(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    input_path: String,
) -> Result<Vec<TranscriptSegment>, String> {
    let state = state.inner().clone();
    state.cancel.store(false, Ordering::SeqCst);

    // 1. Get the path to our bundled Whisper model
    let model_path = app
        .path()
        .resolve(WHISPER_MODEL_FILE, tauri::path::BaseDirectory::Resource)
        .map_err(|e| format!("Failed to find model: {e}"))?;

    // 2. Get App Data Dir AND create it if it doesn't exist
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Failed to get app data dir".to_string())?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {e}"))?;

    let temp_wav_path = app_data_dir.join("temp_audio.wav");
    let _temp_guard = TempFileGuard(temp_wav_path.clone());

    // 3. Run the FFmpeg Sidecar
    let sidecar_command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Failed to create ffmpeg command: {e}"))?
        .args([
            "-y",
            "-i",
            &input_path,
            "-ar",
            "16000",
            "-ac",
            "1",
            "-c:a",
            "pcm_s16le",
            temp_wav_path
                .to_str()
                .ok_or_else(|| "Invalid temp wav path".to_string())?,
        ]);

    let output = sidecar_command
        .output()
        .await
        .map_err(|e| format!("FFmpeg execution failed: {e}"))?;

    // If FFmpeg fails, return its exact error message
    if !output.status.success() {
        let error_message = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg failed. Reason: {error_message}"));
    }

    // 4. Read the WAV file into the f32 buffer Whisper expects
    let audio_data = read_wav_samples(&temp_wav_path)?;

    // 5. Initialize and run Whisper off the async runtime
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_whisper(&state, &model_path, audio_data, app_handle)
    })
    .await
    .map_err(|e| format!("Transcription task failed: {e}"))?
}

#[tauri::command]
fn cancel_transcription(state: tauri::State<'_, AppState>) {
    state.cancel.store(true, Ordering::SeqCst);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init()) // Enables the shell/sidecar API
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            transcribe_audio,
            cancel_transcription
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
