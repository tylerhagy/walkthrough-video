---
name: walkthrough-video
description: Make a narrated, captioned walkthrough video (MP4 + SRT) of an HTML prototype. Use when asked for a walkthrough video, a recorded demo, or a narrated walkthrough of a prototype. Drafts the script, stops for approval on a script page, then records and delivers one video, as short as the story allows.
allowed-tools:
  - Bash(node *)
  - Bash(python3 *)
  - Bash(ffmpeg *)
  - Bash(open *)
  - Read
  - Edit
  - Write
---

# walkthrough-video

The tool is in this skill's folder (`~/.claude/skills/walkthrough-video/`). Its `README.md` has the scenes-file format and every action; `example.scenes.mjs` is a tiny working example. Do not rebuild tooling per request. If `node_modules/` is missing, tell the user to run `./setup.sh` once.

## Defaults (change any per video, or when the user says so)

- Plain, direct voice. Write for an internal audience hearing it once. Design point of view, not a finished spec.
- Voice: Kokoro `af_heart` at speed 0.95 if installed (`./setup.sh --voice`), otherwise macOS `Evan (Enhanced)`.
- No captions drawn on the video by default (they cover the work). The `.srt` is always written beside it. Turn captions on only when asked (`captions: true`).
- One video, as short as the story allows. No separate short cut unless asked. If asked for ultra short or more detailed, write the script to that length from the start rather than trimming or padding.
- Title and end cards: dark, minimal. Concise copy, strong hierarchy.
- Save the video next to the work it shows. Publishing is the user's call; this skill only makes the file.

## Steps

1. **Read** the prototype and any notes on how to open it. Note its path.
2. **Fidelity check before any script.** The video shows the prototype as if it were the product, so it must look like the product. Compare it with the real screens it stands in for (layout, sections, header, panels, spacing). Fix gaps first, or tell the user if a screen can't be matched.
3. **Draft the story and script** as a scenes file: for each scene `id`, `chapter`, `screen` (what is on screen), `text` (narration). No cues yet. Arc: the problem in one sentence, who it hurts and how often, then each moment as a step toward solving it, then what changes and how we'll know. Cut scenes that don't tie back to the problem. Name real fields and screens; no invented numbers.
   - **Tell them what you'll tell them, tell them, tell them what you told them.** Scene 1 ends on an agenda card. Number the changes out loud. Before the outcomes, a recap card (card lines can be `[headline, detail]`).
   - **Lay of the land first:** show each screen once, spotlighting its main regions, before the workflow. Then at each step say what the screen is for and why a component was chosen. Reasons come from recorded decisions, not invention.
   - **Room to digest:** `hold: { 'phrase': 1 to 1.5 }` for a pause mid-scene, and a `beat` of 1.5 to 2s after each change.
   - **Next steps carry context:** what it is, why it matters, who acts.
   - **Audience:** someone outside the work. No version numbers, prototype history, tool names, or how the research was done, unless asked.
4. **Script approval page, then stop.** `node approve.mjs <scenes.mjs> --out <scratch dir>`. Open `approve.html` for the user and wait. Nothing is recorded before they approve. Revise on their comments.
5. **Write the cues**: `[phrase in the text, action, arg]`. Put prototype-specific actions in `actions`, demo data in `setup`. Each phrase must appear in the narration (the tool errors if not).
6. **Dry run**: `node record.mjs <scenes.mjs> --out <dir> --dry`, then read the screenshots in `<dir>/dry`. Fix selectors and data until the errors line says `none`.
7. **Record** (real time, about the video's length): `node record.mjs <scenes.mjs> --out <dir>` then `python3 mux.py <dir>`.
8. **Check sync**: pull 3 or 4 frames with `ffmpeg -ss <t> -i walkthrough.mp4 -frames:v 1 f.png` and compare them to the SRT times. Look at one zoom frame and the end card, and check the page fills the frame.
9. **Save** `Name (YYYY-MM-DD).mp4`, `.srt`, and the script beside the work. Never overwrite an earlier video; date the new one.
10. **Tell the user** where the files are.

## Lessons

- **Dry run first.** A real run costs its full length in real time.
- **Demo data bites.** Earlier steps change state; pick filters and targets after the steps that change data, and check they return rows.
- **Pick targets the screen can reach**, and open them through the UI, not internal functions.
- **Spotlights fade.** A screenshot right after one looks faint; fine in video.
- **Zoom is crop and scale** of a 1440x900 recording, so it is softer. Short moments only.
- **Long sessions are expensive.** Build and run in a fresh session; write the scenes file to disk early.
- Plain copy in the prototype's own words. No notes or explainers in the prototype file; the tool injects overlays at runtime only.
- Write fewer words. End a scene on its outcome, then a `beat`. Open with one concrete number from the screen.
- Use `lead`, `beat` and `waitfor` per scene. Sounds: a small pop under each click, soft key taps under typing, a two-note chime when work completes (`['phrase', 'sound', 'done']`), near-silent room tone. No music.
