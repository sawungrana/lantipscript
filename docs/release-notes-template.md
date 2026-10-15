# Release Notes Template

Copy this into the GitHub Release body and fill in the placeholders. Keep the
"Which build?" table — it is the main defense against wrong-SKU downloads.

---

# LantipScript vX.Y.Z

<one-line summary>

Home: [lantip.space/lantipscript](https://lantip.space/lantipscript)

## Downloads — pick your build

All builds are the same app, and all of them are fully offline; they differ only
in the listening model they carry. Sizes are macOS DMG measurements (Windows
installers are similar); Full is the recommended default.

| Build | Choose it when | Accuracy / speed | Download |
| --- | --- | --- | --- |
| **Full** | Recent machine with GPU acceleration | Best accuracy (`large-v3-turbo`) | 538 MB |
| **Lite** | Older laptop, GPU-less PC, CPU-only | Good accuracy, ~3x faster than Full on CPU (`small`) | 204 MB |
| **Express** | Low bandwidth, rough first pass | Fastest, lower accuracy (`tiny`) | 56 MB |

- **macOS (Apple Silicon):** `lantipscript_X.Y.Z_aarch64_<build>.dmg`
- **Windows (x64):** `lantipscript_X.Y.Z_x64_<build>-setup.exe`

Not sure which one? Full if the machine is new, Lite if it isn't. The gear icon in
the app header shows the active build (edition + model) and whether GPU
acceleration is in use.

## What's new

- <change 1>
- <change 2>

## Notes

- No cloud, no account, no upload: the audio and the transcript never leave your computer.
- Auto-detects English and Bahasa Indonesia.
- Express carries the smallest model — keep it for drafts, and let Full or Lite do real research transcripts.
