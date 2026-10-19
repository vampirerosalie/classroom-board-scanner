#!/usr/bin/env node
/** Reproducible, original board templates. QR encoder: qrcode, MIT. */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const QRCode = require('qrcode');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'public', 'templates');
const samples = path.join(root, 'public', 'samples');
fs.mkdirSync(out, { recursive: true });
fs.mkdirSync(samples, { recursive: true });
const geometry = {
  page: { width: 297, height: 210, unit: 'mm', orientation: 'landscape' },
  qr: { x: 20, y: 18, width: 42, height: 42, version: 1, modules: 21, moduleSize: 2, errorCorrection: 'M', quietZone: 8 },
  answerBorder: { x: 20, y: 82, width: 257, height: 108 },
  answerCrop: { x: 26, y: 88, width: 245, height: 96 },
};
const boards = Array.from({ length: 40 }, (_, i) => {
  const id = `S${String(i + 1).padStart(3, '0')}`;
  const qr = QRCode.create(id, { version: 1, errorCorrectionLevel: 'M' });
  if (qr.modules.size !== 21) throw new Error(`${id}: unexpected QR size`);
  return { id, matrix: Array.from(qr.modules.data) };
});
function svg(board, answer = '') {
  const modules = board.matrix.flatMap((on, i) => on ? [`<rect x="${20 + (i % 21) * 2}" y="${18 + Math.floor(i / 21) * 2}" width="2" height="2"/>`] : []).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="297mm" height="210mm" viewBox="0 0 297 210" role="img" aria-label="Blank classroom response board ${board.id}">
  <title>Classroom response board ${board.id}</title>
  <desc>A4 landscape. QR payload ${board.id}. The answer area is blank for writing.</desc>
  <rect width="297" height="210" fill="white"/>
  <g fill="black" shape-rendering="crispEdges">${modules}</g>
  <g font-family="Arial, Helvetica, sans-serif" fill="#173247">
    <rect x="90" y="14" width="12" height="1.5" rx="0.75"/>
    <text x="90" y="24" font-size="4" letter-spacing="0.7">CLASSROOM RESPONSE BOARD</text>
    <text x="90" y="46" font-size="21" font-weight="700">${board.id}</text>
    <text x="90" y="58" font-size="4.3" fill="#4b5a66">Keep the QR visible. Write one answer below.</text>
    <text x="20" y="78" font-size="3.5" font-weight="700" letter-spacing="0.5">YOUR ANSWER</text>
    <rect x="20" y="82" width="257" height="108" rx="2" fill="none" stroke="#53616d" stroke-width="0.6"/>
    <text x="20" y="199" font-size="3.1" fill="#53616d">Write large and dark. Keep your answer inside the frame.</text>
    <text x="277" y="199" font-size="3.1" text-anchor="end" fill="#53616d">A4 LANDSCAPE · ACTUAL SIZE</text>
  </g>
  ${answer ? `<text x="148.5" y="154" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif" font-size="60" font-weight="700" fill="black">${answer}</text>` : ''}
</svg>\n`;
}
for (const board of boards) fs.writeFileSync(path.join(out, `${board.id}.svg`), svg(board));
fs.writeFileSync(path.join(out, 'geometry.json'), JSON.stringify(geometry, null, 2) + '\n');
const fixtureDefs = [['S001', 'A'], ['S002', 'B'], ['S003', 'C'], ['S004', 'D'], ['S005', 'went']];
const fixtureManifest = fixtureDefs.map(([id, answer]) => ({
  filename: `synthetic-${id}-${answer}.png`,
  studentId: id, answer,
  kind: 'synthetic-typeset',
  width: 1188, height: 840, pixelsPerMillimetre: 4,
  purpose: 'Geometry and pipeline smoke test only; not handwriting-accuracy evidence.'
}));
fs.writeFileSync(path.join(samples, 'manifest.json'), JSON.stringify({ geometry, fixtures: fixtureManifest }, null, 2) + '\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Print classroom response boards</title>
<style>
:root { color-scheme: light; font-family: system-ui, sans-serif; color: #173247; background: #eef2f5; }
body { margin: 0; } .toolbar { max-width: 1060px; margin: auto; padding: 28px 24px; }
h1 { font-size: 27px; margin: 0 0 10px; } p { line-height: 1.6; max-width: 780px; }
.actions { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
button, select, a.button { font: inherit; padding: 11px 16px; border-radius: 8px; border: 1px solid #c0cbd3; background: white; color: #173247; }
button { background: #173247; color: white; cursor: pointer; border-color: #173247; }
a { color: #244f70; } a.button { text-decoration: none; } .hint { font-size: 14px; }
.board { width: min(1060px, calc(100% - 32px)); margin: 0 auto 24px; background: white; box-shadow: 0 5px 25px #17324718; }
.board img { display: block; width: 100%; height: auto; } .board[hidden] { display: none; }
@page { size: A4 landscape; margin: 0; }
@media print { :root, body { background: white; margin: 0; padding: 0; } .toolbar { display: none !important; }
.board { width: 297mm; height: 210mm; padding: 0; margin: 0; box-shadow: none; break-after: page; page-break-after: always; overflow: hidden; }
.board:last-of-type { break-after: auto; page-break-after: auto; } .board img { width: 297mm; height: 210mm; } }
</style></head><body>
<header class="toolbar"><h1>Print your classroom boards</h1>
<p>Each board identifies one student with an ID-only QR. The large answer area stays blank for writing. Print on <strong>A4 landscape at 100% / actual size</strong>, with browser headers and footers off. Avoid “fit to page”.</p>
<div class="actions"><label for="set">Board set </label><select id="set"><option value="5">S001–S005 · 5 students</option><option value="10" selected>S001–S010 · 10 students</option><option value="40">S001–S040 · 40 students</option><option value="1">S001 · test sheet</option></select><button id="print" type="button">Print selected boards</button><a class="button" href="boards-S001-S005.pdf">Open 5-board PDF</a> <a class="button" href="boards-S001-S005.pdf" download>Download 5-board PDF</a><a class="button" href="boards-S001-S010.pdf">Open 10-board PDF</a> <a class="button" href="boards-S001-S010.pdf" download>Download 10-board PDF</a><a class="button" href="boards-S001-S040.pdf">Open 40-board PDF</a> <a class="button" href="boards-S001-S040.pdf" download>Download 40-board PDF</a></div>
<p class="hint">Check a printed sheet with a ruler: the black QR square must measure 42 × 42 mm. Use a matte sleeve or card for repeated use; avoid glare. Student names are never encoded. <a href="../../">Back to scanner</a></p>
</header><main id="boards">${boards.map((b, i) => `<section class="board" data-number="${i + 1}"${i >= 10 ? ' hidden' : ''}><img src="${b.id}.svg" alt="Blank response board ${b.id}" width="1188" height="840"></section>`).join('\n')}</main>
<script>
const select = document.querySelector('#set');
select.addEventListener('change', () => { const count = Number(select.value); document.querySelectorAll('.board').forEach(board => { board.hidden = Number(board.dataset.number) > count; }); });
document.querySelector('#print').addEventListener('click', () => window.print());
</script></body></html>\n`;
fs.writeFileSync(path.join(out, 'index.html'), html);
const licensePath = path.join(path.dirname(require.resolve('qrcode/package.json')), 'license');
const fallbackLicensePath = path.join(path.dirname(require.resolve('qrcode/package.json')), 'LICENSE');
const actualLicense = [licensePath, fallbackLicensePath].find(f => fs.existsSync(f));
if (actualLicense) fs.writeFileSync(path.join(out, 'QRCODE-LICENSE.txt'), fs.readFileSync(actualLicense));
else throw new Error('Cannot locate qrcode license');
const fontLicense = '/usr/share/doc/fonts-dejavu-core/copyright';
if (fs.existsSync(fontLicense)) fs.copyFileSync(fontLicense, path.join(out, 'FONT-LICENSE.txt'));
// Python is used for dependable vector PDFs and high-resolution synthetic PNGs.
// All board dimensions and QR matrices above are passed without recalculation.
const python = String.raw`
import json, os, sys
from reportlab.pdfgen import canvas
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from PIL import Image, ImageDraw, ImageFont
p = json.load(sys.stdin)
boards, out, samples = p['boards'], p['out'], p['samples']
W, H = 297, 210
ink, muted = '#173247', '#53616d'
font_paths=['/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf','/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf']
font_path=next((f for f in font_paths if os.path.exists(f)),None)
if not font_path: raise RuntimeError('Install DejaVu Sans to generate PDFs and synthetic samples.')
bold_path=font_path.replace('Sans.ttf','Sans-Bold.ttf').replace('-Regular.ttf','-Bold.ttf')
if not os.path.exists(bold_path): bold_path=font_path
pdfmetrics.registerFont(TTFont('BoardSans',font_path))
pdfmetrics.registerFont(TTFont('BoardSans-Bold',bold_path))

def pdf_text(c, x, y, text, size, bold=False, color=ink, right=False):
    c.setFillColor(color)
    c.setFont('BoardSans-Bold' if bold else 'BoardSans', size * mm)
    (c.drawRightString if right else c.drawString)(x * mm, (H-y) * mm, text)

def pdf_board(c, b):
    c.setFillColorRGB(1,1,1); c.rect(0,0,W*mm,H*mm,fill=1,stroke=0)
    c.setFillColorRGB(0,0,0)
    for i,on in enumerate(b['matrix']):
        if on: c.rect((20+(i%21)*2)*mm,(H-18-(i//21)*2-2)*mm,2*mm,2*mm,fill=1,stroke=0)
    c.setFillColor(ink); c.roundRect(90*mm,(H-15.5)*mm,12*mm,1.5*mm,.75*mm,fill=1,stroke=0)
    pdf_text(c,90,24,'CLASSROOM RESPONSE BOARD',4)
    pdf_text(c,90,46,b['id'],21,True)
    pdf_text(c,90,58,'Keep the QR visible. Write one answer below.',4.3,color=muted)
    pdf_text(c,20,78,'YOUR ANSWER',3.5,True)
    c.setStrokeColor(muted); c.setLineWidth(.6*mm)
    c.roundRect(20*mm,(H-190)*mm,257*mm,108*mm,2*mm,fill=0,stroke=1)
    pdf_text(c,20,199,'Write large and dark. Keep your answer inside the frame.',3.1,color=muted)
    pdf_text(c,277,199,'A4 LANDSCAPE / ACTUAL SIZE',3.1,color=muted,right=True)
    c.showPage()
for count in (5,10,40):
    target = os.path.join(out,f'boards-S001-S{count:03d}.pdf')
    c=canvas.Canvas(target,pagesize=(W*mm,H*mm),pageCompression=1,invariant=1)
    c.setTitle(f'Classroom response boards S001-S{count:03d}')
    c.setAuthor('Classroom Board Scanner')
    c.setSubject('A4 landscape, actual-size print templates with ID-only QR codes')
    for b in boards[:count]: pdf_board(c,b)
    c.save()

S=4

def font(size,bold=False): return ImageFont.truetype(bold_path if bold else font_path,round(size*S))
def draw_board(b,answer=None):
    im=Image.new('RGB',(W*S,H*S),'white'); d=ImageDraw.Draw(im)
    for i,on in enumerate(b['matrix']):
        if on:
            x=(20+(i%21)*2)*S; y=(18+(i//21)*2)*S
            d.rectangle([x,y,x+2*S-1,y+2*S-1],fill='black')
    d.rounded_rectangle([90*S,14*S,102*S,15.5*S],radius=.75*S,fill=ink)
    def txt(x,y,t,size,bold=False,color=ink,anchor='ls'):
        d.text((x*S,y*S),t,font=font(size,bold),fill=color,anchor=anchor)
    txt(90,24,'CLASSROOM RESPONSE BOARD',4)
    txt(90,46,b['id'],21,True)
    txt(90,58,'Keep the QR visible. Write one answer below.',4.3,color=muted)
    txt(20,78,'YOUR ANSWER',3.5,True)
    d.rounded_rectangle([20*S,82*S,277*S,190*S],radius=2*S,outline=muted,width=round(.6*S))
    txt(20,199,'Write large and dark. Keep your answer inside the frame.',3.1,color=muted)
    txt(277,199,'A4 LANDSCAPE / ACTUAL SIZE',3.1,color=muted,anchor='rs')
    if answer:
        f=font(60,True)
        bbox=d.textbbox((0,0),answer,font=f)
        width,height=bbox[2]-bbox[0],bbox[3]-bbox[1]
        # Text is centered in the fixed inner crop; the crop holds no labels/border.
        x=(26+245/2)*S-width/2-bbox[0]
        y=(88+96/2)*S-height/2-bbox[1]
        d.text((x,y),answer,font=f,fill='black')
    return im
for fixture in p['fixtures']:
    b=next(b for b in boards if b['id']==fixture['studentId'])
    draw_board(b,fixture['answer']).save(os.path.join(samples,fixture['filename']))
draw_board(boards[0]).save(os.path.join(samples,'synthetic-S001-blank.png'))
print('Generated vector PDFs and six synthetic PNGs at 1188 x 840.')
`;
const result = spawnSync(process.env.PYTHON || 'python3', ['-c', python], {
  input: JSON.stringify({ boards, out, samples, fixtures: fixtureManifest }), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024
});
if (result.status !== 0) { console.error(result.stderr || result.error || 'Python generation failed. Install reportlab and Pillow.'); process.exit(1); }
console.log(result.stdout.trim());
console.log('Generated 40 blank SVGs, 5/10/40-board PDF sets, HTML print view, geometry, licenses, and fixture manifest.');
