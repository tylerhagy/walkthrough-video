#!/usr/bin/env bash
# One-time setup for walkthrough-video. Safe to re-run.
set -e
cd "$(dirname "$0")"
[ "$(uname)" = "Darwin" ] || { echo "macOS only (uses say, afinfo, afconvert)."; exit 1; }
for c in node python3 ffmpeg; do
  command -v "$c" >/dev/null || { echo "Missing: $c. Install it (for ffmpeg: brew install ffmpeg), then re-run."; exit 1; }
done
echo "Installing playwright-core and its headless browser..."
npm install --no-audit --no-fund
npx playwright-core install chromium-headless-shell

if [ "$1" = "--voice" ]; then
  command -v uv >/dev/null || { echo "The better voice needs uv (brew install uv)."; exit 1; }
  D="$HOME/.cache/walkthrough-tts"; mkdir -p "$D"; cd "$D"
  uv venv --python 3.12 venv && uv pip install --python venv/bin/python kokoro-onnx soundfile
  B=https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0
  curl -sL -O $B/kokoro-v1.0.onnx && curl -sL -O $B/voices-v1.0.bin
  echo "Kokoro voice installed."
else
  echo "Voice: using the macOS voice. For a better offline voice, run: ./setup.sh --voice"
fi
echo "Done. Try: node approve.mjs example.scenes.mjs --out /tmp/wt-example"
