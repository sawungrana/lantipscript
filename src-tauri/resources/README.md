# Models

Exactly one Whisper model ships inside each build — see
[docs/MODELS.md](../../docs/MODELS.md) for the Full/Lite/Express models, their
download URLs, and checksums.

The model `.bin` files are gitignored; this README stays so the folder is never
empty. `tauri build` validates the `resources/*` glob at compile time and fails
on a fresh checkout otherwise. CI drops the right model next to this file before
bundling, and local development should too.
