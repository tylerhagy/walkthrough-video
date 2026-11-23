#!/usr/bin/env python3
"""Joins a recording with its narration, captions and close-up zooms.

  python3 mux.py <out dir> [--name walkthrough]

Reads marks.json, raw/last.txt, audio/*.aiff and caps/*.png written by record.mjs.
Writes <name>.mp4 (H.264 + AAC, captions drawn in) and <name>.srt in the same folder.
ffmpeg here has no libass or drawtext, so captions are transparent PNGs laid over the video.
"""
import json, subprocess, sys, os

args = sys.argv[1:]
name = 'walkthrough'
if '--name' in args:
    i = args.index('--name'); name = args[i + 1]; del args[i:i + 2]
os.chdir(args[0] if args else '.')
m = json.load(open('marks.json'))
v = open('raw/last.txt').read().strip()
VW, VH = m['viewport']['width'] * m.get('scale', 1), m['viewport']['height'] * m.get('scale', 1)   # recorded pixels
OW, OH = m.get('outw', VW), m.get('outh', VH)                                                    # delivered pixels
CS = m.get('scale', 1)                                                                           # page px -> recorded px
trim = max(0, m['marks'][0].get('st', m['marks'][0]['at']) - 0.1)
end = m['end']
dur = end - trim

# narration: each scene's audio placed at its recorded offset
ins, flt = [], []
for i, s in enumerate(m['marks']):
    ins += ['-i', f"audio/{s['id']}.wav"]
    flt.append(f"[{i+2}:a]aresample=48000,adelay={int((s['at']-trim)*1000)}:all=1[a{i}]")
n = len(m['marks'])
flt.append(''.join(f'[a{i}]' for i in range(n)) + f"amix=inputs={n}:normalize=0,apad[nar]")
# sounds under the action (files in sounds/, made by sounds/make.py):
# a pop under each recorded click, soft key taps under typing, a chime when work completes,
# and a very quiet room tone so silence is not dead. A scenes file can turn any off with sounds: { click: false, ... }.
HERE = os.path.dirname(os.path.abspath(__file__))
SND = m.get('soundsOn', {})
GAIN = {'click': 0.14, 'key': 0.07, 'done': 0.16}
events = {'click': [c - trim for c in m.get('clicks', []) if c - trim > 0]}
for e in m.get('sounds', []):
    if e['t'] - trim > 0: events.setdefault(e['name'], []).append(e['t'] - trim)
nin = len(ins) // 2 + 2
parts = ['[nar]']
for snd, times in events.items():
    if not times or SND.get(snd) is False: continue
    files = [os.path.join(HERE, 'sounds', f'key{i}.wav') for i in range(1, 5)] if snd == 'key' else [os.path.join(HERE, 'sounds', f'{snd}.wav')]
    files = [f for f in files if os.path.exists(f)]
    if not files: continue
    groups = [[t for j, t in enumerate(times) if j % len(files) == k] for k in range(len(files))]
    for f, ts in zip(files, groups):
        if not ts: continue
        ins += ['-i', f]; ci = nin; nin += 1
        tag = f'{snd}{ci}'
        flt.append(f"[{ci}:a]aresample=48000,aformat=sample_rates=48000:channel_layouts=mono,volume={GAIN.get(snd, 0.12)},asplit={len(ts)}" + ''.join(f'[{tag}_{j}]' for j in range(len(ts))))
        for j, t in enumerate(ts):
            flt.append(f"[{tag}_{j}]adelay={int(t*1000)}:all=1[{tag}d{j}]")
            parts.append(f'[{tag}d{j}]')
ins += ['-f', 'lavfi', '-t', f'{dur+1:.1f}', '-i', "anoisesrc=d=%d:c=pink:a=0.006:r=48000" % (dur + 1)]
ri = nin
if SND.get('room') is not False:
    flt.append(f"[{ri}:a]lowpass=f=700,volume=0.5[room]")
    parts.append('[room]')
flt.append(''.join(parts) + f"amix=inputs={len(parts)}:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=9[aout]")

# caption track: one PNG per interval (blank where nothing shows), as a concat list
lines, t = [], trim
for iv in m['intervals']:
    a, b = max(iv['from'], trim), iv['to']
    if b <= trim or b <= a: continue
    if a > t: lines.append((os.path.abspath('caps/blank.png'), a - t))
    lines.append((os.path.abspath(iv['png'] or 'caps/blank.png'), b - a)); t = b
if t < end: lines.append((os.path.abspath('caps/blank.png'), end - t))
with open('caps/list.txt', 'w') as f:
    for p, d in lines: f.write(f"file '{p}'\nduration {d:.3f}\n")
    f.write(f"file '{lines[-1][0]}'\n")

# close-up zoom: smooth in and out; scale up then crop back to frame size
def smooth(a, b, r=0.7):
    up = f"clip((t-{a:.3f})/{r},0,1)"; dn = f"clip(({b:.3f}-t)/{r},0,1)"
    s = f"min({up},{dn})"
    return f"({s}*{s}*(3-2*{s}))"
zs = sorted((z for z in m['zooms'] if z['to'] - z['from'] > 1.0), key=lambda z: z['from'])
fin = f"scale={OW}:{OH}:flags=lanczos"
if zs:
    es = [smooth(z['from'] - trim, z['to'] - trim) for z in zs]
    Z = '(1' + ''.join(f"+{z['z']-1:.4f}*{e}" for z, e in zip(zs, es)) + ')'
    CX = f"({VW/2}" + ''.join(f"+{z['cx']*CS-VW/2:.2f}*{e}" for z, e in zip(zs, es)) + ')'
    CY = f"({VH/2}" + ''.join(f"+{z['cy']*CS-VH/2:.2f}*{e}" for z, e in zip(zs, es)) + ')'
    vz = (f"fps=30,scale=w='trunc({VW}*{Z}/2)*2':h='trunc({VH}*{Z}/2)*2':eval=frame:flags=bicubic,"
          f"crop={VW}:{VH}:x='min(max({CX}*{Z}-{VW/2},0),{VW}*({Z}-1))':y='min(max({CY}*{Z}-{VH/2},0),{VH}*({Z}-1))',{fin}")
else:
    vz = f'fps=30,{fin}'
flt.insert(0, f"[0:v]{vz}[vz]")
flt.insert(1, "[1:v]fps=30,format=rgba[cap]")
flt.insert(2, "[vz][cap]overlay=0:0:format=auto:eof_action=pass,format=yuv420p[vout]")

subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-ss', f'{trim:.2f}', '-i', v,
                '-f', 'concat', '-safe', '0', '-i', 'caps/list.txt'] + ins +
               ['-filter_complex', ';'.join(flt), '-map', '[vout]', '-map', '[aout]', '-t', f'{dur:.2f}',
                '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30',
                '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', f'{name}.mp4'], check=True)

def ts(x):
    x = max(0, x); h = int(x // 3600); mi = int(x % 3600 // 60); s = x % 60
    return f"{h:02}:{mi:02}:{int(s):02},{int((s % 1) * 1000):03}"
with open(f'{name}.srt', 'w') as f:
    f.write('\n'.join(f"{i+1}\n{ts(c['from']-trim)} --> {ts(c['to']-trim)}\n{c['x']}\n" for i, c in enumerate(m['caps'])))
print(f'wrote {name}.mp4 ({dur:.1f}s) and {name}.srt')
