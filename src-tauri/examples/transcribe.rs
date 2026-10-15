use hound;
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

fn main() {
    let mut args = std::env::args().skip(1);
    let audio = match args.next() {
        Some(path) => PathBuf::from(path),
        None => {
            eprintln!("usage: transcribe <audio file> [model path] [--gpu|--cpu]");
            std::process::exit(2);
        }
    };
    let mut model = PathBuf::from("resources/ggml-large-v3-turbo-q5_0.bin");
    let mut use_gpu = cfg!(any(feature = "metal", feature = "vulkan"));
    for arg in args {
        match arg.as_str() {
            "--gpu" => use_gpu = true,
            "--cpu" => use_gpu = false,
            other => model = PathBuf::from(other),
        }
    }

    let ffmpeg = [
        "bin/ffmpeg-aarch64-apple-darwin",
        "bin/ffmpeg-x86_64-apple-darwin",
        "bin/ffmpeg-x86_64-pc-windows-msvc.exe",
    ]
    .iter()
    .map(PathBuf::from)
    .find(|path| path.is_file())
    .expect("no ffmpeg sidecar found in src-tauri/bin");

    let temp_wav = std::env::temp_dir().join("lantipscript_example.wav");
    let status = Command::new(&ffmpeg)
        .args(["-y", "-i"])
        .arg(&audio)
        .args(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
        .arg(&temp_wav)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .expect("failed to run ffmpeg");
    if !status.success() {
        eprintln!("ffmpeg conversion failed");
        std::process::exit(1);
    }

    let mut reader = hound::WavReader::open(&temp_wav).expect("failed to open temp wav");
    let audio_data: Vec<f32> = reader
        .samples::<i16>()
        .map(|sample| sample.expect("failed to read sample") as f32 / 32768.0)
        .collect();
    let duration = audio_data.len() as f64 / 16000.0;

    let mut ctx_params = WhisperContextParameters::default();
    ctx_params.use_gpu(use_gpu);

    println!(
        "model: {} (gpu: {use_gpu})\nloading...",
        model.display()
    );
    let load_start = Instant::now();
    let ctx = WhisperContext::new_with_params(&model, ctx_params).expect("failed to load model");
    println!("loaded in {:?}", load_start.elapsed());

    let mut state = ctx.create_state().expect("failed to create state");
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(num_cpus::get_physical().max(1) as i32);
    params.set_language(Some("auto"));
    params.set_translate(false);
    params.set_print_special(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_progress_callback_safe(|progress| {
        if progress % 10 == 0 {
            eprintln!("  {progress}%");
        }
    });

    println!(
        "transcribing {} ({:.1} min of audio)...",
        audio.display(),
        duration / 60.0
    );
    let start = Instant::now();
    state.full(params, &audio_data).expect("transcription failed");
    let elapsed = start.elapsed();

    for i in 0..state.full_n_segments() {
        let Some(segment) = state.get_segment(i) else {
            continue;
        };
        let start_ms = segment.start_timestamp() * 10;
        let end_ms = segment.end_timestamp() * 10;
        let text = segment.to_str_lossy().unwrap_or_default();
        println!(
            "[{:02}:{:02}.{:03} -> {:02}:{:02}.{:03}] {}",
            start_ms / 60000,
            (start_ms / 1000) % 60,
            start_ms % 1000,
            end_ms / 60000,
            (end_ms / 1000) % 60,
            end_ms % 1000,
            text.trim()
        );
    }

    println!("\nwall clock: {:.1?}", elapsed);
    println!("real-time factor: {:.1}x", duration / elapsed.as_secs_f64());

    let _ = std::fs::remove_file(&temp_wav);
}
