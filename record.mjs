#!/usr/bin/env node
// Records a narrated walkthrough of an HTML prototype.
//   (--dry --fast runs through the cues without waiting for the narration clock: quick selector checks)
//   node record.mjs <scenes.mjs> [--prototype <file|url>] [--out <dir>] [--short] [--dry] [--voice "Evan (Enhanced)"] [--rate 170]
//   python3 mux.py <out dir>            (joins video, narration, captions and zoom into walkthrough.mp4 and .srt)
// --dry takes a screenshot at every cue instead of recording video. --short records only scenes marked core.
import fs from 'fs'
import path from 'path'
import os from 'os'
import { fileURLToPath } from 'url'
import { parseArgs, loadScenes, makeAudio, resolveVoice, totalSeconds, loadPlaywright, findHeadlessShell, phraseTime, GAP, CUE_LEAD, LEAD_IN, fmt } from './lib.mjs'
import { renderCaptions } from './captions.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const args = parseArgs(process.argv.slice(2))
if (!args._[0]) { console.error('usage: node record.mjs <scenes.mjs> [--prototype file|url] [--out dir] [--short] [--dry]'); process.exit(1) }
const SHORT = !!args.short, DRY = !!args.dry, FAST = DRY && !!args.fast   // --dry --fast skips waiting for the narration clock
const cfg = await loadScenes(args._[0], { short: SHORT })
const name = path.basename(cfg.__file).replace(/\.mjs$/, '')
const OUT = path.resolve(args.out || path.join(os.tmpdir(), 'walkthrough-' + name)) + (SHORT ? '/short' : '')
fs.mkdirSync(OUT, { recursive: true })
const { voice, rate } = resolveVoice(cfg, args)
const scenes = cfg.active
const VP = cfg.viewport
const OUTW = cfg.outWidth || 1920, OUTH = Math.round(OUTW * VP.height / VP.width / 2) * 2
const SC = DRY ? 1 : (cfg.scale || 1)      // 1x by default: some headless shells ignore 2x in video capture; set scale: 2 where it works
const BURN = cfg.captions === true          // captions are not drawn into the video unless the scenes file asks; the .srt is always written

// prototype location: --prototype, else cfg.prototype (relative to the scenes file), file path or http(s) URL
const proto = args.prototype || cfg.prototype
if (!proto) throw new Error('No prototype: set `prototype` in the scenes file or pass --prototype')
const URL_ = /^(https?|file|data):/.test(proto) ? proto : 'file://' + (path.isAbsolute(proto) ? proto : path.resolve(cfg.__dir, proto))

// 1. voice
makeAudio(cfg, scenes, OUT, { voice, rate })
console.log(`voice: ${voice} @ ${rate} · narration ${fmt(totalSeconds(scenes))} (${SHORT ? 'short cut' : 'full'})`)

// 2. browser
const { chromium } = await loadPlaywright()
const exe = findHeadlessShell()
const browser = await chromium.launch(exe ? { executablePath: exe } : {})
const ctx = await browser.newContext({ viewport: VP, deviceScaleFactor: SC, ...(DRY ? {} : { recordVideo: { dir: `${OUT}/raw`, size: { width: VP.width * SC, height: VP.height * SC } } }) })
const p = await ctx.newPage()
const T0 = Date.now(), now = () => (Date.now() - T0) / 1000
const errs = []
p.on('pageerror', e => errs.push(e.message))
await p.goto(URL_)
await p.waitForTimeout(cfg.settle ?? 2500)
await p.evaluate(fs.readFileSync(path.join(HERE, 'overlays.js'), 'utf8'))
if (cfg.intro) await p.evaluate(c => window.__vw.card(c, true), cfg.intro)

// helper API: passed to built-in and custom actions
const ev = (fn, a) => p.evaluate(fn, a)
const h = { p, ev, state: {}, cur: { x: VP.width / 2, y: 520 }, zooms: [], zoomOpen: null, clicks: [], cards: [], hides: [], sounds: [] }
h.wait = ms => p.waitForTimeout(ms)
h.moveTo = async (x, y) => { h.cur = { x, y }; await ev(([x, y]) => window.__vw.cursorTo(x, y), [x, y]); await p.waitForTimeout(FAST ? 0 : 160) }   // a short hover on arrival
h.rip = async () => { await ev(() => window.__vw.press(true)); await p.waitForTimeout(90); h.clicks.push(now()); await ev(([x, y]) => { window.__vw.ripple(x, y); window.__vw.press(false) }, [h.cur.x, h.cur.y]) }
// regions: named areas in the scenes file ({x,y,width,height} or a function returning a Locator or rect)
h.box = async sel => {
  const r = cfg.regions && cfg.regions[sel]
  if (r) {
    if (typeof r === 'object' && 'x' in r) return r
    const v = await r(h)
    return v && 'x' in v ? v : await v.boundingBox()
  }
  const L = p.locator(sel).first()
  await L.scrollIntoViewIfNeeded().catch(() => {}); await p.waitForTimeout(150)
  return await L.boundingBox()
}
h.unspot = () => ev(() => window.__vw.unspot())
h.spot = async sel => {
  const bb = await h.box(sel); if (!bb) throw new Error('spot: nothing at ' + sel)
  const pad = 6
  await ev(([x, y, w, ww]) => window.__vw.spot(x, y, w, ww), [bb.x - pad, bb.y - pad, bb.width + pad * 2, bb.height + pad * 2])
}
h.click = async sel => {
  const L = p.locator(sel).first()
  await L.scrollIntoViewIfNeeded().catch(() => {})
  const bb = await L.boundingBox(); if (!bb) throw new Error('click: nothing at ' + sel)
  await h.moveTo(bb.x + Math.min(bb.width / 2, bb.width - 14), bb.y + bb.height / 2)
  await h.rip(); await L.click(); await p.waitForTimeout(300)
}
h.choose = async ([sel, opt]) => {
  await h.click(sel)
  const o = p.locator(`li[role=option]:has-text("${opt}"), [role=option]:has-text("${opt}"), option:has-text("${opt}")`).first()
  const bb = await o.boundingBox()
  await h.moveTo(bb.x + 60, bb.y + bb.height / 2); await h.rip(); await o.click(); await p.waitForTimeout(350)
}
// a named sound at this moment (mux.py places it): 'done' when work completes, 'key' per typed character
h.sound = name => { h.sounds.push({ t: now(), name }) }
h.key = async ch => { h.sound('key'); await p.keyboard.type(ch) }
h.type = async ([sel, text]) => { await h.click(sel); for (const ch of text) { await h.key(ch); await p.waitForTimeout(45 + Math.random() * 75 + (/[ .,]/.test(ch) ? 60 : 0)) } await p.waitForTimeout(450) }
h.zoomTo = async arg => {
  const o = typeof arg === 'string' ? { sel: arg } : arg
  const bb = await h.box(o.sel); if (!bb) throw new Error('zoom: nothing at ' + o.sel)
  const pad = o.pad ?? 40, max = o.max ?? 2.2
  let x = bb.x - pad, y = bb.y - pad, w = bb.width + pad * 2, hh = bb.height + pad * 2
  const z = Math.max(1, Math.min(max, VP.width / w, VP.height / hh))
  const rect = { cx: Math.min(VP.width - VP.width / z / 2, Math.max(VP.width / z / 2, x + w / 2)), cy: Math.min(VP.height - VP.height / z / 2, Math.max(VP.height / z / 2, y + hh / 2)), z }
  await h.unzoom()
  h.zoomOpen = { from: now(), ...rect }
  if (DRY) { const cw = VP.width / z, ch = VP.height / z; await p.screenshot({ path: `${OUT}/dry/zoom-${String(h.shot + 1).padStart(2, '0')}.png`, clip: { x: rect.cx - cw / 2, y: rect.cy - ch / 2, width: cw, height: ch } }) }
}
h.unzoom = async () => { if (h.zoomOpen) { h.zooms.push({ ...h.zoomOpen, to: now() }); h.zoomOpen = null } }
// card and hide times go into marks.json so the mix can place transition sounds and music
h.card = c => { h.cards.push({ t: now(), kind: c === 'outro' ? 'outro' : c === 'intro' ? 'intro' : 'card' }); return ev(x => window.__vw.card(x), c === 'outro' ? cfg.outro : c === 'intro' ? cfg.intro : c) }

const BUILT = {
  spot: a => h.spot(a),
  unspot: () => h.unspot(),
  click: async a => { await h.unspot(); await h.click(a) },
  choose: async a => { await h.unspot(); await h.choose(a) },
  type: async a => { await h.unspot(); await h.type(a) },
  scroll: async a => { if (typeof a === 'number') { for (let i = 1; i <= 12; i++) { await p.mouse.wheel(0, a * (Math.sin(Math.PI * i / 12) - Math.sin(Math.PI * (i - 1) / 12)) / 2); await p.waitForTimeout(32) } } else await p.locator(a).first().scrollIntoViewIfNeeded(); await p.waitForTimeout(500) },
  wait: a => p.waitForTimeout(a),
  sound: a => h.sound(a),
  waitfor: a => p.locator(a).first().waitFor({ timeout: 5000 }),   // hold until something is on screen, then carry on
  press: a => p.keyboard.press(a),
  card: a => h.card(a),
  hidecard: () => { h.hides.push(now()); return ev(() => window.__vw.hideCard()) },
  zoom: a => h.zoomTo(a),
  unzoom: () => h.unzoom(),
}
const act = async (name, arg) => (cfg.actions && cfg.actions[name]) ? cfg.actions[name](h, arg) : BUILT[name](arg)

if (cfg.setup) await cfg.setup(h)
if (DRY) fs.mkdirSync(`${OUT}/dry`, { recursive: true })

// 3. play scenes
const marks = [], caps = [], chapters = []
h.shot = 0
let first = true, lastChapter = null
for (const s of scenes) {
  if (s.skipped) { for (const [a, arg] of s.quiet) { try { await act(a, arg) } catch (e) { errs.push(`${s.id} quiet ${a}: ${e.message.split('\n')[0]}`) } } continue }
  const st = now()                                   // the scene begins; the screen settles, then the narration starts
  const lead = s.lead ?? LEAD_IN, a0 = st + lead      // a0 = when the voice starts
  marks.push({ id: s.id, st, at: a0, dur: s.dur })
  if (s.chapter && s.chapter !== lastChapter) chapters.push({ from: st, to: st + Math.min(4, lead + s.dur), x: s.chapter })
  lastChapter = s.chapter || lastChapter
  // exact sentence times from the rendered audio
  caps.push(...s.sents.map((o, i) => ({ from: a0 + o.at, to: i + 1 < s.sents.length ? a0 + s.sents[i + 1].at : a0 + s.dur, x: o.x })))
  const cueAt = s.cues.map(([ph, a, arg]) => ({ t: Math.max(st, a0 + phraseTime(s, ph) - CUE_LEAD), a, arg }))
  for (const e of cueAt.sort((a, b) => a.t - b.t)) {
    const w = e.t * 1000 - (Date.now() - T0); if (w > 0 && !FAST) await p.waitForTimeout(w)
    try { await act(e.a, e.arg) } catch (err) { errs.push(`${s.id} ${e.a} ${JSON.stringify(e.arg)}: ${err.message.split('\n')[0]}`) }
    if (DRY) await p.screenshot({ path: `${OUT}/dry/${String(++h.shot).padStart(2, '0')}-${s.id}-${e.a}.png` })
  }
  const w = (a0 + s.dur) * 1000 - (Date.now() - T0); if (w > 0 && !FAST) await p.waitForTimeout(w)
  await h.unzoom()
  if (first && cfg.intro) { h.hides.push(now()); await ev(() => window.__vw.hideCard()) }
  first = false
  await p.waitForTimeout((s.beat ?? GAP) * 1000)   // a beat of silence so the result registers before the next scene
}
await p.waitForTimeout(cfg.tail ?? 2500)
await h.unzoom()
const END = now()
const vpath = DRY ? null : await p.video().path()
await ctx.close()

// 4. captions + chapter labels as PNGs for the mux step
let intervals = []
if (!DRY) intervals = await renderCaptions(browser, { caps: BURN ? caps : [], chapters }, `${OUT}/caps`, VP, OUTW / VP.width)
await browser.close()
fs.writeFileSync(`${OUT}/marks.json`, JSON.stringify({ marks, end: END, caps, chapters, zooms: h.zooms, clicks: h.clicks, cards: h.cards, hides: h.hides, sounds: h.sounds, soundsOn: cfg.sounds ?? {}, intervals, viewport: VP, scale: SC, outw: OUTW, outh: OUTH, video: vpath }, null, 1))
if (vpath) fs.writeFileSync(`${OUT}/raw/last.txt`, vpath)
console.log('video', vpath || '(dry run)', 'end', fmt(END), '· zooms', h.zooms.length)
console.log('errors:', errs.length ? errs : 'none')
if (DRY) console.log('screenshots in', `${OUT}/dry`)
