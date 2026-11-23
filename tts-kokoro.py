#!/usr/bin/env python3
"""Local neural narration voice (Kokoro-82M, Apache-2.0, offline). Used by record.mjs via `tts` in the scenes file:
   tts: { cmd: 'tts-kokoro.py {in} {out} {voice}' }   (record.mjs fills the paths; the path to this script is resolved for you)
Setup is in README.md ("Better voice"). Writes a WAV for the text file."""
import sys, os, soundfile as sf
from kokoro_onnx import Kokoro
src, out, voice = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'am_michael'
speed = float(os.environ.get('KOKORO_SPEED', '0.95'))
d = os.path.expanduser('~/.cache/walkthrough-tts')
k = Kokoro(f'{d}/kokoro-v1.0.onnx', f'{d}/voices-v1.0.bin')
a, sr = k.create(open(src).read().strip(), voice=voice, speed=speed, lang='en-gb' if voice.startswith('b') else 'en-us')
sf.write(out, a, sr, format='WAV')
