# Benchmarks

Baseline and comparison measurements for transcription performance. Fill in as
machines become available.

## How to measure

- Use the **same audio file** across runs and record its duration.
- Note the **model**, **backend** (CPU / Metal / Vulkan), and **thread count**.
- Record **wall-clock** transcription time and compute **RTF** (real-time factor =
  audio duration / wall-clock; higher is better, >1 means faster than real time).
- Ideally run twice and take the second run (model warm).

`RTF = audio_seconds / transcribe_seconds`

## Baseline (pre-GPU-backend) — 2026-10-15

| Machine | Model | Backend | Audio | Wall clock | RTF | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| MacBook Pro M2 16 GB | small | CPU + Accelerate | ? | ~10 s | ? | rough, from user report |
| AMD Ryzen 7 5800U 16 GB | small | CPU (AVX2) | ? | ~5 min | ? | rough, from user report; test machine in use |

The two rows above are informal reports for the same (unspecified) audio and are the
motivation for this work (~30x gap). Exact file, duration, and RTF still need to be
recorded.

## Target measurements (after Phase 1–2)

| Machine | Model | Backend | Audio | Wall clock | RTF | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| MacBook Pro M2 16 GB | small | Metal | | | | |
| MacBook Pro M2 16 GB | large-v3-turbo-q5_0 | Metal | | | | |
| AMD Ryzen 7 5800U 16 GB | small | Vulkan | | | | |
| AMD Ryzen 7 5800U 16 GB | large-v3-turbo-q5_0 | Vulkan | | | | |
| AMD Ryzen 7 5800U 16 GB | small | CPU | | | | fallback path |

Expected: Vulkan on the Ryzen 7 5800U should be roughly in line with upstream's
Renoir (4750U) numbers — Vulkan ~2.7–4x real time vs CPU below 1x for
`large-v3-turbo`.

## Upstream reference (for context)

From the whisper.cpp ecosystem, AMD Ryzen 7 4750U (RADV Renoir), `large-v3-turbo`:

| Backend | 11 s clip | 35 s clip |
| --- | --- | --- |
| Vulkan | 4.14 s (2.7x) | 8.70 s (4.1x) |
| CPU | 19.85 s (0.6x) | 40.18 s (0.9x) |
