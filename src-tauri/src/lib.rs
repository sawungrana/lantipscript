use hound;
use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

#[derive(serde::Serialize)]
pub struct TranscriptSegment {
    pub start_ms: i64,
    pub end_ms: i64,
    pub text: String,
}

// This is our main transcription command that React will call
#[tauri::command]
async fn transcribe_audio(
    app: tauri::AppHandle,
    input_path: String,
) -> Result<Vec<TranscriptSegment>, String> {
    // 1. Get the path to our bundled Whisper model
    let resource_path = app
        .path()
        .resolve(
            "resources/ggml-small.bin",
            tauri::path::BaseDirectory::Resource,
        )
        .map_err(|e| format!("Failed to find model: {}", e))?;

    // 2. Get App Data Dir AND create it if it doesn't exist
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "Failed to get app data dir".to_string())?;

    // Create the directory!
    std::fs::create_dir_all(&app_data_dir)
        .map_err(|e| format!("Failed to create app data directory: {}", e))?;

    let temp_wav_path = app_data_dir.join("temp_audio.wav");

    // 3. Run the FFmpeg Sidecar
    let sidecar_command = app
        .shell()
        .sidecar("ffmpeg")
        .map_err(|e| format!("Failed to create ffmpeg command: {}", e))?
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
            temp_wav_path.to_str().unwrap(),
        ]);

    let output = sidecar_command
        .output()
        .await
        .map_err(|e| format!("FFmpeg execution failed: {}", e))?;

    // IMPROVED ERROR LOGGING: If FFmpeg fails, return its exact error message!
    if !output.status.success() {
        let error_message = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg failed. Reason: {}", error_message));
    }

    // 4. Read the WAV file using 'hound'
    let mut reader = hound::WavReader::open(&temp_wav_path)
        .map_err(|e| format!("Failed to open wav file: {}", e))?;

    // Convert audio to the 32-bit floats that Whisper expects
    let audio_data: Vec<f32> = reader
        .samples::<i16>()
        .map(|s| s.unwrap() as f32 / 32768.0)
        .collect();

    // 5. Initialize Whisper
    let ctx = WhisperContext::new_with_params(
        resource_path.to_str().unwrap(),
        WhisperContextParameters::default(),
    )
    .map_err(|e| format!("Failed to load Whisper model: {}", e))?;

    let mut state = ctx
        .create_state()
        .map_err(|e| format!("Failed to create state: {}", e))?;

    // Set Whisper parameters (Multilingual, let it auto-detect English or Indonesian)
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_print_progress(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    // THE LANGUAGE FIX:
    params.set_language(Some("auto")); // Let Whisper detect Bahasa Indonesia or English
    params.set_translate(false); // Force it to transcribe, not translate

    // 6. Run the transcription
    state
        .full(params, &audio_data)
        .map_err(|e| format!("Transcription failed: {}", e))?;

    // 7. Collect the text AND timestamps
    let num_segments = state
        .full_n_segments()
        .map_err(|e| format!("Failed to get segments: {}", e))?;

    let mut segments = Vec::new();
    for i in 0..num_segments {
        if let Ok(text) = state.full_get_segment_text(i) {
            // Whisper gives time in 10ms increments. Multiply by 10 to get milliseconds.
            let start_ms = state.full_get_segment_t0(i).unwrap_or(0) * 10;
            let end_ms = state.full_get_segment_t1(i).unwrap_or(0) * 10;

            segments.push(TranscriptSegment {
                start_ms,
                end_ms,
                text: text.trim().to_string(),
            });
        }
    }

    // Clean up the temp file
    let _ = std::fs::remove_file(temp_wav_path);

    // Return the array of segments!
    Ok(segments)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init()) // Enables the shell/sidecar API
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![transcribe_audio]) // Register our command
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
