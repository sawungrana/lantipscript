# LantipScript 🎙️✨

**LantipScript** is a beautiful, privacy-first, 100% offline AI transcription app built specifically for qualitative researchers. Named after my clever son, Lantip, this app ensures your interview data never leaves your computer.

Built with **Tauri v2**, **React**, and **Whisper.cpp**, wrapped in a playful "Soft Neo-Brutalism" design.

### ✨ Features
- **100% Offline & Private:** No cloud, no internet required. Your participant data stays on your hard drive.
- **Multilingual AI:** Automatically detects and transcribes English and Bahasa Indonesia.
- **Visual Timeline Sync:** Click any paragraph and the audio instantly jumps to that exact moment.
- **Pro-Editor Vibe:** Edit the generated text on the fly.
- **Frictionless Export:** One-click export to a clean `.txt` file with timestamps, ready for NVivo or Atlas.ti.

### 📥 Download & Install (For Users)
1. Go to the [Releases](../../releases) page.
2. Download the latest `.dmg` (Mac) or `.msi` (Windows).
3. Install and enjoy!

### 💻 Developer Setup (For Nerds)
Want to build it yourself? 

1. Clone the repo: `git clone https://github.com/sawungrana/lantipscript.git`
2. Install dependencies: `npm install`
3. **The Brains:** Download the `ggml-small.bin` Whisper model and put it in `src-tauri/resources/`.
4. **The Ears:** Download the static FFmpeg binary for your OS, rename it properly (e.g., `ffmpeg-aarch64-apple-darwin`), and put it in `src-tauri/bin/`.
5. Run it: `npm run tauri dev`

---
*Designed with ❤️ for qualitative researchers.*