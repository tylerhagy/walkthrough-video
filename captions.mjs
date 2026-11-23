// Draws captions and chapter labels as transparent full-frame PNGs, one per interval, for mux.py to lay over the video.
// Done after recording so they stay sharp and fixed when a close-up zoom runs.
import fs from 'fs'

const CSS = `
html,body{margin:0;background:transparent}
body{width:var(--w);height:var(--h);position:relative;font-family:-apple-system,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
#cap{position:absolute;left:50%;bottom:34px;transform:translateX(-50%);max-width:1080px;background:rgba(10,14,20,.82);color:#f2f4f7;font-weight:500;font-size:27px;line-height:1.38;letter-spacing:-.005em;padding:12px 24px 13px;border-radius:14px;text-align:center;box-shadow:0 6px 24px rgba(0,0,0,.28)}\n#cap b{font-weight:700;color:#fff;background:linear-gradient(transparent 62%,rgba(66,153,255,.55) 62%)}
#chap{position:absolute;right:28px;top:80px;background:#1976d2;color:#fff;font-weight:500;font-size:15px;line-height:1;padding:9px 14px;border-radius:18px}`

// events: { caps:[{from,to,x}], chapters:[{from,to,x}] } in absolute seconds. Returns [{from,to,png}] (png null = nothing shown).
export async function renderCaptions(browser, { caps, chapters }, dir, viewport, dsf = 1) {
  fs.mkdirSync(dir, { recursive: true })
  const cuts = new Set()
  for (const e of [...caps, ...chapters]) { cuts.add(+e.from.toFixed(3)); cuts.add(+e.to.toFixed(3)) }
  const pts = [...cuts].sort((a, b) => a - b)
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: dsf })
  const p = await ctx.newPage()
  const out = []
  const cache = new Map()
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], mid = (a + b) / 2
    const cap = caps.find(c => c.from <= mid && mid < c.to)
    const chap = chapters.find(c => c.from <= mid && mid < c.to)
    if (!cap && !chap) { out.push({ from: a, to: b, png: null }); continue }
    const key = (cap ? cap.x : '') + '|' + (chap ? chap.x : '')
    let png = cache.get(key)
    if (!png) {
      png = `${dir}/c${String(cache.size + 1).padStart(4, '0')}.png`
      const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
      const em = s => esc(s).replace(/(\$?\d(?:[\d,.:]*\d)?%?(?:\s(?:payments?|files?|meters?|items?))?)/g, '<b>$1</b>')   // numbers and amounts get the emphasis
      await p.setContent(`<style>${CSS}</style><body style="--w:${viewport.width}px;--h:${viewport.height}px">${cap ? `<div id=cap>${em(cap.x)}</div>` : ''}${chap ? `<div id=chap>${esc(chap.x)}</div>` : ''}</body>`)
      await p.screenshot({ path: png, omitBackground: true })
      cache.set(key, png)
    }
    out.push({ from: a, to: b, png })
  }
  await ctx.close()
  // blank frame for gaps
  const ctx2 = await browser.newContext({ viewport, deviceScaleFactor: dsf })
  const p2 = await ctx2.newPage()
  await p2.setContent(`<style>html,body{margin:0;background:transparent}</style><body></body>`)
  await p2.screenshot({ path: `${dir}/blank.png`, omitBackground: true })
  await ctx2.close()
  return out
}
