// Injected into the page at runtime by record.mjs. Never written into the prototype.
// Cursor, click ripple, spotlight, title/end cards. Captions and chapter labels are not here:
// they are drawn onto the video afterwards so they stay crisp and fixed when a close-up zoom runs.
(() => {
  if (window.__vw) return
  const st = document.createElement('style')
  st.textContent = `
  #vw-cur{position:fixed;left:0;top:0;width:22px;height:22px;z-index:100001;pointer-events:none;transform:translate(720px,520px);will-change:transform}
  #vw-cur svg{transition:transform .09s ease-out;transform-origin:3px 2px}#vw-cur.dn svg{transform:scale(.84)}
  #vw-rip{position:fixed;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;background:rgba(25,118,210,.35);z-index:100000;pointer-events:none;opacity:0;transform:scale(.3)}
  #vw-rip.on{animation:vwr .5s ease-out}@keyframes vwr{0%{opacity:1;transform:scale(.3)}100%{opacity:0;transform:scale(1.4)}}
  #vw-spot{position:fixed;z-index:99998;pointer-events:none;border-radius:12px;box-shadow:0 0 0 3px #1976d2,0 0 0 4000px rgba(15,23,32,.32);opacity:0;transition:all .45s ease}
  #vw-card{position:fixed;inset:0;z-index:100003;background:#000;color:#f5f5f7;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;
    padding:0 120px;font-family:-apple-system,"SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;opacity:0;transition:opacity .9s ease;pointer-events:none}
  #vw-card .in{max-width:1080px;transform:translateY(10px);transition:transform 1.1s cubic-bezier(.2,.7,.2,1)}
  #vw-card.on{opacity:1}#vw-card.on .in{transform:none}
  #vw-card .k{font-size:21px;font-weight:600;letter-spacing:.01em;color:#86868b;margin:0 0 20px}
  #vw-card .t{font-size:84px;font-weight:700;letter-spacing:-.035em;line-height:1.04;margin:0}
  #vw-card .s{font-size:28px;font-weight:400;letter-spacing:-.005em;line-height:1.35;color:#86868b;margin:22px 0 0}
  #vw-card .l{font-size:50px;font-weight:600;letter-spacing:-.03em;line-height:1.15;margin:0 0 14px}
  #vw-card .l:nth-of-type(n+2){color:#f5f5f7}
  #vw-card .l .d{display:block;font-size:24px;font-weight:400;letter-spacing:0;line-height:1.35;color:#86868b;margin:8px 0 22px}
  #vw-card .f{position:absolute;left:0;right:0;bottom:46px;font-size:16px;color:#6e6e73;letter-spacing:.01em}`
  document.head.appendChild(st)
  const mk = (id, html) => { const d = document.createElement('div'); d.id = id; if (html) d.innerHTML = html; document.body.appendChild(d); return d }
  mk('vw-spot'); mk('vw-rip'); mk('vw-card')
  mk('vw-cur', '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2 L3 18 L7.5 14 L10.5 20.5 L13 19.4 L10.1 13 L16 13 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>')
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
  window.__vw = {
    pos: { x: 720, y: 520 },
    // Human-looking move: a curved path (control point off the straight line), ease in and out, a small overshoot that settles.
    cursorTo(x, y, ms) {
      const el = document.getElementById('vw-cur'), a = { ...this.pos }, self = this
      const dx = x - a.x, dy = y - a.y, dist = Math.hypot(dx, dy) || 1
      const bend = Math.min(90, dist * 0.18) * (dx >= 0 ? 1 : -1) * (Math.random() < .5 ? 1 : .6)
      const c = { x: a.x + dx * .5 - dy / dist * bend, y: a.y + dy * .5 + dx / dist * bend }
      const over = dist > 120 ? { x: x + dx / dist * 7, y: y + dy / dist * 5 } : { x, y }
      const T = ms || Math.max(420, Math.min(1100, 300 + dist * 0.9))
      const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
      return new Promise(res => {
        const t0 = performance.now()
        const put = (px, py) => { el.style.transform = `translate(${px - 3}px,${py - 2}px)`; self.pos = { x: px, y: py } }
        const step = now => {
          const k = Math.min(1, (now - t0) / T), e = ease(k), u = 1 - e
          put(u * u * a.x + 2 * u * e * c.x + e * e * over.x, u * u * a.y + 2 * u * e * c.y + e * e * over.y)
          if (k < 1) requestAnimationFrame(step)
          else { const t1 = performance.now(); const settle = n => { const kk = Math.min(1, (n - t1) / 160); put(over.x + (x - over.x) * kk, over.y + (y - over.y) * kk); if (kk < 1) requestAnimationFrame(settle); else res() }; requestAnimationFrame(settle) }
        }
        requestAnimationFrame(step)
      })
    },
    press(down) { document.getElementById('vw-cur').classList.toggle('dn', down) },
    ripple(x, y) { const r = document.getElementById('vw-rip'); r.style.left = x + 'px'; r.style.top = y + 'px'; r.classList.remove('on'); void r.offsetWidth; r.classList.add('on') },
    spot(x, y, w, h) { const s = document.getElementById('vw-spot'); Object.assign(s.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px', opacity: 1 }) },
    unspot() { document.getElementById('vw-spot').style.opacity = 0 },
    // card: { kicker, title, sub, lines: [..], footer }; a line can be [headline, detail]
    card(c, instant) {
      const el = document.getElementById('vw-card')
      el.innerHTML = '<div class="in">' + (c.kicker ? `<p class="k">${esc(c.kicker)}</p>` : '') + (c.title ? `<h1 class="t">${esc(c.title)}</h1>` : '') +
        (c.lines || []).map(l => Array.isArray(l) ? `<p class="l">${esc(l[0])}<span class="d">${esc(l[1])}</span></p>` : `<p class="l">${esc(l)}</p>`).join('') + (c.sub ? `<p class="s">${esc(c.sub)}</p>` : '') + '</div>' + (c.footer ? `<div class="f">${esc(c.footer)}</div>` : '')
      if (instant) { el.style.transition = 'none'; el.querySelector('.in').style.transition = 'none' }
      void el.offsetWidth
      el.classList.add('on')
      if (instant) setTimeout(() => { el.style.transition = ''; el.querySelector('.in').style.transition = '' }, 50)
    },
    hideCard() { document.getElementById('vw-card').classList.remove('on') },
  }
})()
