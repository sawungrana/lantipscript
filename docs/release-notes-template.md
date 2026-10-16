# Release Notes Template

Copy this into the GitHub Release body and fill in the placeholders. Keep the
"Which build?" table — it is the main defense against wrong-SKU downloads.

---

# LantipScript vX.Y.Z

<one-line summary>

Home: [lantip.space/lantipscript](https://lantip.space/lantipscript)

## Downloads — pick your build

All builds are the same app, and all of them are fully offline; they differ only
in the listening model they carry. Sizes are the actual uploaded assets
(macOS / Windows); Full is the recommended default.

| Build | Choose it when | Accuracy / speed | Download |
| --- | --- | --- | --- |
| **Full** | Recent machine with GPU acceleration | Best accuracy (`large-v3-turbo`) | 564 MB / 572 MB |
| **Lite** | Older laptop, GPU-less PC, CPU-only | Good accuracy, ~3x faster than Full on CPU (`small`) | 214 MB / 237 MB |
| **Express** | Low bandwidth, rough first pass | Fastest, lower accuracy (`tiny`) | 58 MB / 85 MB |

- **macOS (Apple silicon):** `lantipscript_<build>_mac_X.Y.Z_aarch64.dmg`
- **Windows (64-bit):** `lantipscript_<build>_windows_X.Y.Z_x64.exe`

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
