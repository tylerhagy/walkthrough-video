# walkthrough-video

A Claude Code skill and tool that makes narrated MP4 + SRT walkthroughs of HTML prototypes. Claude drafts the script, you approve it on a page, then it records.

## Install

```bash
git clone https://github.com/tylerhagy/walkthrough-video ~/.claude/skills/walkthrough-video
cd ~/.claude/skills/walkthrough-video
./setup.sh            # playwright-core + headless browser. Add --voice for the offline Kokoro voice
```

Needs macOS, Node 18+, Python 3 and `ffmpeg` (`brew install ffmpeg`). Then ask Claude Code for a walkthrough video of a prototype, or run `/walkthrough-video`.

---

# walkthrough

Narrated, captioned MP4 walkthroughs of any HTML prototype. You write a scenes file (narration, plus "at this phrase, do this"), the tool drives the prototype in a headless browser, speaks the narration with a macOS voice, and joins it all into a video with captions and an SRT.

Nothing is written into the prototype. The cursor, click ripples, spotlight and cards are injected at runtime only.

## Pieces

| File | What it does |
|---|---|
| `approve.mjs` | Builds the script approval page (scene cards, narration you can play, full and short lengths). Records nothing. |
| `record.mjs` | Voice per scene, drives the prototype, writes `marks.json`. `--dry` takes a screenshot at every cue instead of recording. `--short` records the short cut. |
| `mux.py` | Joins video, narration, captions and close-up zooms into `walkthrough.mp4` and `.srt`. |
| `overlays.js` | In-page cursor, ripple, spotlight and cards. |
| `captions.mjs` | Draws captions and chapter labels as transparent PNGs (this ffmpeg has no libass or drawtext). |
| `lib.mjs` | Scenes loading and checks, voice, shared bits. |
| `example.scenes.mjs` | A tiny scenes file against an inline page. Copy it to start. |

## Run

```bash
cd ~/.claude/skills/walkthrough-video
node approve.mjs path/to/scenes.mjs --out /tmp/wt          # 1. script approval page, then stop for approval
node record.mjs  path/to/scenes.mjs --out /tmp/wt --dry     # 2. dry run, read the screenshots in /tmp/wt/dry
node record.mjs  path/to/scenes.mjs --out /tmp/wt           # 3. record (takes the video's length in real time)
python3 mux.py /tmp/wt                                      # 4. /tmp/wt/walkthrough.mp4 and .srt
# Optional, only when a second length is asked for: --short, then python3 mux.py /tmp/wt/short --name walkthrough-short
```

Options for `record.mjs` and `approve.mjs`: `--prototype <file|url>`, `--voice "Evan (Enhanced)"`, `--rate 170`.

Needs macOS (`say`, `afinfo`, `afconvert`), `ffmpeg`, Python 3, and `playwright-core` with its headless shell. `./setup.sh` installs playwright-core and its headless shell here. Or set `PLAYWRIGHT_CORE` to an existing `index.mjs`.

## The scenes file

An ES module. `export default { ... }`:

```js
export default {
  title: 'Name shown on the approval page',
  prototype: '../Prototype.html',       // relative to this file, or an http(s) URL
  viewport: { width: 1440, height: 900 },
  voice: 'Evan (Enhanced)', rate: 170,  // defaults
  intro: { kicker, title, sub, footer },        // opening card, shown during scene 1
  outro: { kicker, lines: [..], footer },       // closing card, shown with the 'card' action; a line can be [headline, detail]
  regions: { page: {x,y,width,height}, NAME: h => locator },   // named areas for spot and zoom
  async setup(h) {},                    // after load: pick demo targets, store in h.state
  actions: { name: async (h, arg) => {} },   // actions specific to this prototype
  scenes: [
    { id: 's1', chapter: 'Label', core: true,
      screen: 'What is on screen (approval page only).',
      text: 'Narration. Full sentences.',
      cues: [ ['phrase in the text', 'action', arg], ... ],
      short: { text, cues },            // wording for the short cut (optional)
      quiet: [ ['action', arg] ],       // runs silently when the scene is skipped in the short cut
    },
  ],
}
```

A cue starts about 0.75 seconds before the phrase is spoken, so the cursor lands as the word does. A cue phrase that is not in the narration is an error.

### Built-in actions

`spot` (selector or region), `unspot`, `click` (selector), `choose` ([selector, option text]), `type` ([selector, text]), `scroll` (selector or pixels), `wait` (ms), `press` (key), `card` (`'outro'`, `'intro'` or a card object), `hidecard`, `zoom` (selector, or `{sel, pad, max}`), `unzoom`.

Custom actions get `h`: `h.p` (Playwright page), `h.ev`, `h.state`, `h.click`, `h.spot`, `h.unspot`, `h.choose`, `h.type`, `h.moveTo`, `h.rip`, `h.wait`, `h.box`, `h.card`.

### Close-up zoom

`zoom` crops and enlarges a region (up to 2.2x) with a smooth ease, and `unzoom` returns. A zoom ends on its own at the end of its scene. Source video is 1440x900, so zoom is softer than the full frame; keep it to short moments. Captions and chapter labels are laid over the video afterward, so zooms never crop them.

### Second length (optional)

One video, as short as the story allows, is the default. Record a second length only when asked. Mark scenes `core: true`. `--short` records only those, using each scene's `short` wording when given. It is a separate recording pass, so the core scenes must work without the scenes between them. Anything the skipped scenes changed that a later scene needs goes in `quiet`. Quiet steps should be instant (no cursor walk), or they leave dead air.

## Defaults

Evan (Enhanced) at rate 170. Captions are not drawn into the video by default (`captions: true` in the scenes file turns them on); the `.srt` is always written beside it. Recorded at 1x by default (`scale: 2` where the headless shell supports it). Plain, direct narration. Dark, minimal title and end cards. One video, as short as the story allows; no default short cut. Publishing stays manual.

## Better voice (local, free)

`record.mjs` uses Kokoro-82M (Apache-2.0, offline) when it is installed, and macOS `say` otherwise. One-time setup, nothing system-wide:

```
mkdir -p ~/.cache/walkthrough-tts && cd ~/.cache/walkthrough-tts
uv venv --python 3.12 venv && uv pip install --python venv/bin/python kokoro-onnx soundfile
curl -sL -O https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
curl -sL -O https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin
```

Default voice `af_heart`; others `af_bella`, `am_michael`, `am_fenrir`, `bm_george`. Set `voice` in the scenes file or pass `--voice`. Speed is `kokoroSpeed` (default 0.95). Any other engine: `tts: { cmd: 'my-tts {in} {out}' }`.

## Realism built in

- Narration is rendered one sentence at a time and joined with pauses, so captions and cues use exact times. `lead` (settle time before a scene speaks, default 0.45s) and `beat` (silence after, default 0.7s) are per-scene. `hold: { 'phrase': 1.5 }` adds that much silence after the sentence containing the phrase, so a change on screen can sink in mid-scene.
- Recorded at 2x and delivered at 1920 wide, so close-ups stay sharp.
- The cursor follows a curved, eased path with a small overshoot, hovers before a click and presses; typing has uneven timing; scrolls ease.
- Sounds from `sounds/` (`sounds/make.py` writes them): a small pop under every recorded click, soft key taps under typed characters (`h.key` or the built-in `type`), a two-note chime wherever a scene logs `done` (built-in `sound` action, or `h.sound('done')` in a custom action), and a very quiet room tone. No music. A scenes file can turn any off: `sounds: { click: false, key: false, done: false, room: false }`. Loudness leveled to -16 LUFS. `sounds/samples.py` makes the wider set they were chosen from, including intro and outro stings.
- Captions are larger, with numbers and amounts emphasized. `waitfor` (built-in action) holds until an element is on screen.
