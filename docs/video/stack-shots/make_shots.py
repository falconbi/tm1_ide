#!/usr/bin/env python3
"""Generic 1920x1080 title cards for the Falcon BI / TM1 IDE stack video.
Drawn from scratch (no product logos). Run: python3 make_shots.py  -> NN-name.png"""
import subprocess, html, os

W, H = 1920, 1080
BG, PANEL, LINE = '#0f1419', '#182029', '#2a3542'
FG, MUTED, ACCENT = '#e8edf2', '#8a98a8', '#5fb3a1'   # one restrained accent
SANS, MONO = 'Liberation Sans', 'DejaVu Sans Mono'
OUT = os.path.dirname(os.path.abspath(__file__))

def esc(s): return html.escape(s, quote=True)

def text(x, y, s, size=40, fill=FG, weight='normal', anchor='start', font=SANS):
    return (f'<text xml:space="preserve" x="{x}" y="{y}" font-family="{font}" font-size="{size}" font-weight="{weight}" '
            f'fill="{fill}" text-anchor="{anchor}">{esc(s)}</text>')

def box(x, y, w, h, label, sub='', accent=False):
    stroke = ACCENT if accent else LINE
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="14" fill="{PANEL}" stroke="{stroke}" stroke-width="3"/>',
           text(x + w/2, y + h/2 + (0 if sub else 14), label, 40, FG, 'bold', 'middle')]
    if sub: out.append(text(x + w/2, y + h/2 + 50, sub, 28, MUTED, anchor='middle'))
    return ''.join(out)

def arrow(x1, y, x2, label=''):
    out = [f'<line x1="{x1}" y1="{y}" x2="{x2 - 18}" y2="{y}" stroke="{MUTED}" stroke-width="4"/>',
           f'<polygon points="{x2},{y} {x2-22},{y-12} {x2-22},{y+12}" fill="{MUTED}"/>']
    if label: out.append(text((x1 + x2)/2, y - 22, label, 26, MUTED, anchor='middle'))
    return ''.join(out)

def card(kicker, title, lines=(), extra=''):
    body = [text(140, 230, kicker.upper(), 30, ACCENT, 'bold'),
            text(140, 340, title, 84, FG, 'bold')]
    for i, l in enumerate(lines):
        body.append(text(140, 470 + i * 70, l, 44, MUTED))
    return body + [extra]

def svg(parts):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}">'
            f'<rect width="{W}" height="{H}" fill="{BG}"/>'
            f'<rect x="0" y="{H-10}" width="{W}" height="10" fill="{ACCENT}"/>'
            + ''.join(parts) + '</svg>')

def editor(x, y, w, h, title, code):
    out = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="#11171d" stroke="{LINE}" stroke-width="3"/>',
           f'<rect x="{x}" y="{y}" width="{w}" height="56" rx="12" fill="{PANEL}"/>',
           f'<rect x="{x}" y="{y+40}" width="{w}" height="16" fill="{PANEL}"/>',
           text(x + 30, y + 38, title, 26, MUTED, font=MONO)]
    for i, (col, s) in enumerate(code):
        out.append(text(x + 30, y + 110 + i * 46, f'{i+1:>2}', 30, '#4a5866', font=MONO))
        lead = len(s) - len(s.lstrip(' '))   # the renderer drops leading spaces: use no-break spaces
        out.append(text(x + 100, y + 110 + i * 46, '\u00a0' * lead + s.lstrip(' '), 27, col, font=MONO))
    return ''.join(out)

SHOTS = {
 '01-title': card('Falcon BI', 'TM1 IDE', ['The whole TM1 development loop, in a browser.',
                                           'Rules · TI · dimensions · views · deployment']),

 '02-architecture': card('How it connects', 'Nothing installed on the TM1 server', [], ''.join([
     box(140, 560, 380, 200, 'Browser', 'any machine'),
     arrow(520, 660, 760, 'HTTPS'),
     box(760, 560, 400, 200, 'TM1 IDE', 'Node.js server', accent=True),
     arrow(1160, 660, 1400, 'REST API'),
     box(1400, 560, 380, 200, 'TM1', 'direct or via PAW'),
 ])),

 '03-node': card('The stack · 1', 'Node.js', ['One small server.',
                                               'Every TM1 call goes through one client.',
                                               'JavaScript end to end.']),

 '04-react': card('The stack · 2', 'React', ['The screens: Explorer, editors, grids, Cube Map.',
                                              'Plain components you can read and change.']),

 '05-monaco': card('The stack · 3', 'Monaco editor', ['The editor behind Visual Studio Code —', 'taught TM1 rules and TI.'],
     editor(980, 180, 840, 520, 'WFP Workforce Cost · rules', [
         (MUTED, "#Region Employer pension"),
         (FG,    "['Employee Pension'] = N:"),
         (FG,    "  ['Base Salary'] *"),
         (ACCENT,"  DB('WFP Pay Rates', !WFP Version,"),
         (ACCENT,"     'Pension Pct');"),
         (MUTED, "#EndRegion"),
         (FG,    "FEEDERS;"),
         (FG,    "['Base Salary'] => ['Employee Pension'];"),
     ])),

 '06-history': card('The stack · 4', 'One small file', ['History, change sets and deploy log',
                                                         'live in a single SQLite file next to the app.',
                                                         'No database server to set up.']),

 '07-open-source': card('Open source', 'MIT licence', ['Fully on GitHub. Clone it, run it, change anything.',
                                                       'github.com/falconbi/tm1_ide']),

 '08-ai-reads': card('Readable by design', 'Point an AI agent at the repo', [
     'Plain code an agent can follow:',
     'how the editors, the Cube Map and the MCP server fit together.']),

 '09-mcp': card('The MCP server', 'AI builds like a developer', [], ''.join([
     box(140, 470, 360, 190, 'AI agent'),
     arrow(500, 565, 720, 'tools'),
     box(720, 470, 420, 190, 'MCP server', 'TM1 IDE', accent=True),
     arrow(1140, 565, 1360, 'REST'),
     box(1360, 470, 400, 190, 'TM1 server'),
     text(140, 800, 'Dimensions · cubes · rules · processes', 44, FG),
     text(140, 870, 'Every change tracked in a change set → tested → deployed', 40, MUTED),
 ])),

 '11-ideas': card('A source of ideas', 'Start here, build your own', [], ''.join([
     box(140, 480, 500, 220, 'A custom view', 'for your model'),
     box(710, 480, 500, 220, 'A lighter editor', 'rules your way'),
     box(1280, 480, 500, 220, 'Your own AI tool', 'build with MCP', accent=True),
 ])),

 '12-close': card('github.com/falconbi/tm1_ide', 'Simple stack. Open code.', [
     'Ready for you, or your AI, to learn from and build on.']),
}

for name, parts in SHOTS.items():
    path = os.path.join(OUT, name)
    open(path + '.svg', 'w').write(svg(parts))
    subprocess.run(['convert', '-density', '96', path + '.svg', path + '.png'], check=True)
    os.remove(path + '.svg')
    print(name + '.png')
