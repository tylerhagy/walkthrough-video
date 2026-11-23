// Shared by record.mjs and approve.mjs: load a scenes file, check it, make the narration audio.
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { execSync } from 'child_process'
import { pathToFileURL } from 'url'

export const GAP = 0.7            // silence between scenes, seconds
export const CUE_LEAD = 0.75      // cursor starts moving this long before the phrase is spoken
export const DEFAULT_VOICE = 'Evan (Enhanced)'          // macOS `say` fallback
export const KOKORO_DIR = path.join(os.homedir(), '.cache/walkthrough-tts')
export const HAVE_KOKORO = fs.existsSync(`${KOKORO_DIR}/venv/bin/python`) && fs.existsSync(`${KOKORO_DIR}/kokoro-v1.0.onnx`)
export const DEFAULT_KOKORO_VOICE = 'af_heart'         // US female, Kokoro's top-rated. Others: am_michael, af_bella, am_fenrir, bm_george (British)
const HERE_ = path.dirname(new URL(import.meta.url).pathname)
export const engineOf = (cfg, voice) => cfg.tts?.cmd ? 'cmd' : (voice && /^[ab][mf]_/.test(voice)) ? 'kokoro' : 'say'
export const DEFAULT_RATE = 170

export function parseArgs(argv) {
  const a = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i]
    if (x.startsWith('--')) {
      const k = x.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) a[k] = true
      else { a[k] = next; i++ }
    } else a._.push(x)
  }
  return a
}

let loadCount = 0
export async function loadScenes(file, { short = false } = {}) {
  const abs = path.resolve(file)
  const mod = await import(pathToFileURL(abs).href + '?t=' + Date.now() + '-' + (++loadCount))
  const cfg = mod.default || mod.SCENE_FILE
  if (!cfg || !Array.isArray(cfg.scenes)) throw new Error(`${file}: export default { scenes: [...] } is required`)
  cfg.__file = abs
  cfg.__dir = path.dirname(abs)
  cfg.viewport ||= { width: 1440, height: 900 }
  const problems = []
  const seen = new Set()
  for (const s of cfg.scenes) {
    if (!s.id) problems.push('a scene has no id')
    if (seen.has(s.id)) problems.push(`duplicate scene id ${s.id}`)
    seen.add(s.id)
    for (const v of variants(s)) {
      if (!v.text || !/[.?!](\s|$)/.test(v.text)) problems.push(`${s.id}: narration needs at least one full sentence`)
      for (const c of v.cues || []) {
        const [phrase, action] = c
        if (typeof phrase !== 'string' || v.text.indexOf(phrase) < 0) problems.push(`${s.id}: cue phrase not found in narration: "${phrase}"`)
        if (typeof action === 'string' && !BUILTIN.has(action) && !(cfg.actions && cfg.actions[action])) problems.push(`${s.id}: unknown action "${action}"`)
      }
    }
  }
  for (const s of cfg.scenes) for (const v of variants(s)) for (const ph of Object.keys(v.hold || {})) if (!v.text.includes(ph)) problems.push(`${s.id}: hold phrase not in the narration: "${ph}"`)
  if (problems.length) throw new Error('Scenes file problems:\n - ' + problems.join('\n - '))
  // pick the active variant of each scene
  const picked = []
  for (const s of cfg.scenes) {
    if (short && !s.core) { if (s.quiet) picked.push({ ...s, skipped: true }); continue }
    const v = short && s.short ? s.short : s
    picked.push({ id: s.id, chapter: s.chapter || '', screen: s.screen || '', core: !!s.core, text: v.text, cues: v.cues || [], quiet: s.quiet, lead: s.lead, beat: s.beat, hold: (short && s.short ? s.short.hold : s.hold) || {} })
  }
  cfg.active = picked
  return cfg
}
export const BUILTIN = new Set(['spot', 'unspot', 'click', 'choose', 'type', 'scroll', 'wait', 'press', 'card', 'hidecard', 'zoom', 'unzoom', 'waitfor', 'sound'])
const variants = s => s.short ? [s, s.short] : [s]

export function sentences(text) {
  return text.match(/.+?[.?!]+(?=\s|$)/gs).map(x => x.trim())   // a full stop followed by a space or the end, so $49,370.34 stays whole
}

// Narration is rendered one sentence at a time and joined with explicit pauses, so every sentence has an exact start
// time (captions and cues use it) and the voice breathes. Engine: macOS `say` by default, or any command in
// cfg.tts.cmd with {in} (text file) and {out} (audio file to write), e.g. a local neural TTS.
export const PAUSE = { '.': 0.34, '?': 0.5, '!': 0.34, comma: 0.2 }

function renderSentence(cfg, text, voice, rate, dir) {
  const eng = engineOf(cfg, voice)
  const key = crypto.createHash('sha1').update(JSON.stringify([eng, cfg.tts?.cmd || '', voice, rate, text])).digest('hex').slice(0, 16)
  const wav = `${dir}/audio/s-${key}.wav`
  if (fs.existsSync(wav)) return wav
  const txt = `${dir}/audio/s-${key}.txt`, raw = `${dir}/audio/s-${key}.raw`
  fs.writeFileSync(txt, text)
  if (eng === 'kokoro') execSync(`KOKORO_SPEED=${rate} "${KOKORO_DIR}/venv/bin/python" "${HERE_}/tts-kokoro.py" "${txt}" "${raw}" "${voice}"`)
  else if (cfg.tts?.cmd) execSync(cfg.tts.cmd.replaceAll('{in}', `"${txt}"`).replaceAll('{out}', `"${raw}"`).replaceAll('{voice}', voice))
  else execSync(`say -v "${voice}" -r ${rate} -o "${raw}.aiff" -f "${txt}"`) && fs.renameSync(raw + '.aiff', raw)
  execSync(`ffmpeg -y -loglevel error -i "${raw}" -ar 48000 -ac 1 -af "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse" "${wav}"`)
  fs.unlinkSync(raw)
  return wav
}
const dur = f => parseFloat(execSync(`afinfo "${f}"`).toString().match(/estimated duration: ([\d.]+)/)[1])

export function makeAudio(cfg, scenes, dir, { voice, rate }) {
  fs.mkdirSync(`${dir}/audio`, { recursive: true })
  for (const s of scenes) {
    if (s.skipped) continue
    const sents = sentences(s.text)
    let from = 0, at = 0
    s.sents = sents.map(x => {
      const start = s.text.indexOf(x, from); from = start + x.length
      const wav = renderSentence(cfg, x, voice, rate, dir), d = dur(wav)
      const o = { x, start, at, dur: d, wav }
      at += d + (PAUSE[x.slice(-1)] ?? 0.3) + Math.max(0, ...Object.entries(s.hold || {}).filter(([ph]) => x.includes(ph)).map(([, t]) => t))   // hold: extra silence after a key sentence
      return o
    })
    s.dur = at - (PAUSE[sents[sents.length - 1].slice(-1)] ?? 0.3)
    const out = `${dir}/audio/${s.id}.wav`
    const key = JSON.stringify(s.sents.map(o => [o.wav, o.at]))
    if (!fs.existsSync(out) || !fs.existsSync(out + '.key') || fs.readFileSync(out + '.key', 'utf8') !== key) {
      const ins = s.sents.flatMap(o => ['-i', o.wav])
      const f = s.sents.map((o, i) => `[${i}:a]apad=pad_dur=${(i + 1 < s.sents.length ? s.sents[i + 1].at - o.at - o.dur : 0).toFixed(3)}[p${i}]`)
      f.push(s.sents.map((_, i) => `[p${i}]`).join('') + `concat=n=${s.sents.length}:v=0:a=1[o]`)
      execSync(['ffmpeg', '-y', '-loglevel', 'error', ...ins.map(x => `"${x}"`), '-filter_complex', `"${f.join(';')}"`, '-map', '"[o]"', `"${out}"`].join(' '))
      fs.writeFileSync(out + '.key', key)
    }
  }
}

// seconds from the start of a scene's narration to a phrase (inside its sentence, by character position)
export function phraseTime(s, phrase) {
  const i = s.text.indexOf(phrase)
  const o = s.sents.find(o => i >= o.start && i < o.start + o.x.length) || s.sents[0]
  return o.at + o.dur * Math.max(0, i - o.start) / o.x.length
}

export const LEAD_IN = 0.45   // seconds the screen settles at the start of a scene before the narration begins (scene.lead overrides)
export function totalSeconds(scenes) {
  return scenes.filter(s => !s.skipped).reduce((a, s) => a + (s.lead ?? LEAD_IN) + s.dur + (s.beat ?? GAP), 0) + 2.5   // plus the closing hold
}

// voice: --voice, else the scenes file, else Kokoro (if installed) or macOS Evan. rate: words-per-minute for say, speed (0.95) for Kokoro.
export function resolveVoice(cfg, args) {
  const voice = args.voice || cfg.voice || (HAVE_KOKORO ? DEFAULT_KOKORO_VOICE : DEFAULT_VOICE)
  const k = engineOf(cfg, voice) === 'kokoro'
  return { voice, rate: String(args.rate || (k ? cfg.kokoroSpeed : cfg.rate) || (k ? 0.95 : DEFAULT_RATE)) }
}

export async function loadPlaywright() {
  const cands = [process.env.PLAYWRIGHT_CORE]
  for (const c of cands) {
    if (c && fs.existsSync(c)) return await import(pathToFileURL(c).href)
  }
  try { return await import('playwright-core') } catch {}
  throw new Error('playwright-core not found. Run ./setup.sh, or set PLAYWRIGHT_CORE to its index.mjs path.')
}

export function findHeadlessShell() {
  const root = path.join(os.homedir(), 'Library/Caches/ms-playwright')
  if (!fs.existsSync(root)) return undefined
  const dirs = fs.readdirSync(root).filter(d => d.startsWith('chromium_headless_shell-')).sort().reverse()
  for (const d of dirs) {
    for (const arch of ['chrome-headless-shell-mac-arm64', 'chrome-headless-shell-mac-x64', 'chrome-headless-shell-mac']) {
      const p = path.join(root, d, arch, 'chrome-headless-shell')
      if (fs.existsSync(p)) return p
    }
  }
}

export function fmt(sec) {
  const m = Math.floor(sec / 60), s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}
