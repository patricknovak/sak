// The fan zones' share cards (25 October 2026, Patrick: "share in the most epic and amazing fashions the content and
// information they love"): pictures a fan posts to a story or a group chat, drawn on the phone in the club's own colours
// with its logo: the verdict (the grade, the read, the strengths and weaknesses), the outlook (the chances and the
// projected finish), the history (the titles and the all-time numbers), the fan's own calls beside the fans', the pulse
// and a post from the board. 1080 x 1350, the shape every chat and story shows whole. Nothing leaves the phone until
// the fan shares it; the link under the picture opens the page it came from.
import { fit } from './shareCard';
import type { ShareJob } from './share';

export interface CardClub {
  league: string; code: string; name: string; short?: string | null;
  color: string; deep: string; ink: string;      // the club's accent, its darkest colour, and the ink that reads on the accent
  logo: string | null;                           // the logo for a white tile (an NHL club's _light.svg, ESPN's default)
  logoDark?: string | null;                      // the version for a dark ground, drawn large and faint
  url: string;                                   // where the picture points: the page it was drawn from
}
export interface CardTile { k: string; v: string; sub?: string; tone?: 'good' | 'bad' | 'club' }
export type FanCard =
  | { kind: 'verdict'; club: CardClub; eyebrow: string; grade: string; summary: string; record: string; strengths: { label: string; rank: string }[]; weaknesses: { label: string; rank: string }[]; luck?: string | null }
  | { kind: 'outlook'; club: CardClub; eyebrow: string; headline: { label: string; pct: number }; tiles: CardTile[]; projected: { label: string; mid: string; range: string }; line?: string | null; record?: string }
  | { kind: 'history'; club: CardClub; eyebrow: string; titles: { label: string; years: (number | string)[]; count: number }; tiles: CardTile[]; lines: string[] }
  | { kind: 'calls'; club: CardClub; eyebrow: string; who: string; rows: { title: string; mine: string; agree: number | null }[] }
  | { kind: 'pulse'; club: CardClub; eyebrow: string; people: number; season: string; rows: { title: string; top: string; pct: number; n: number }[] }
  | { kind: 'post'; club: CardClub; eyebrow: string; emoji: string; title: string; body: string; author: string; score: number }
  | { kind: 'question'; club: CardClub; eyebrow: string; title: string; verdict: string; evidence: string[]; action: string; fans: { keep: number; adjust: number; rethink: number; n: number } | null };

const W = 1080, H = 1350;
const DISPLAY = "'Barlow Condensed', 'Inter', system-ui, sans-serif", SANS = "'Inter', system-ui, sans-serif";
const TONE = { good: '#34d399', bad: '#f87171' };

// an image the canvas may draw: ESPN's logos allow it; the NHL's don't, so on the product's addresses they come through
// the Worker (/api/img); anywhere else the card draws the club's letters instead
const EDGE = typeof location !== 'undefined' && /(^|\.)superpools?ai\.com$/.test(location.hostname);
const CORS_OK = /^https:\/\/a\.espncdn\.com\//;
function loadImage(url: string | null | undefined): Promise<HTMLImageElement | null> {
  if (!url) return Promise.resolve(null);
  const src = CORS_OK.test(url) ? url : EDGE ? `/api/img?u=${encodeURIComponent(url)}` : null;
  if (!src) return Promise.resolve(null);
  return new Promise((res) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img); img.onerror = () => res(null);
    img.src = src;
    setTimeout(() => res(null), 6000);
  });
}
const hexRgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (hex: string, a: number) => { const [r, g, b] = hexRgb(hex); return `rgba(${r},${g},${b},${a})`; };

type Ctx = CanvasRenderingContext2D;
// the night and the club's colours, the club at the top, the product at the bottom; returns the y the body may start at
async function frame(ctx: Ctx, club: CardClub, eyebrow: string) {
  ctx.fillStyle = '#070c18'; ctx.fillRect(0, 0, W, H);
  let g = ctx.createLinearGradient(0, 0, W * 0.4, H); g.addColorStop(0, club.deep); g.addColorStop(0.7, '#070c18'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W, 0, 40, W, 0, 900); g.addColorStop(0, rgba(club.color, 0.5)); g.addColorStop(1, rgba(club.color, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  // the club's stripe down the left, fading
  g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, club.color); g.addColorStop(1, rgba(club.color, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, 14, H);
  // the logo, large and faint, off the bottom right
  const [light, dark] = await Promise.all([loadImage(club.logo), loadImage(club.logoDark ?? club.logo)]);
  if (dark) { ctx.save(); ctx.globalAlpha = 0.1; ctx.drawImage(dark, W - 560, H - 640, 620, 620); ctx.restore(); }
  // the header: the logo on a white tile, the club, the eyebrow
  ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(72, 72, 132, 132, 30); ctx.fill();
  if (light) ctx.drawImage(light, 86, 86, 104, 104);
  else { ctx.fillStyle = club.deep; ctx.font = `900 ${club.code.length > 3 ? 40 : 50}px ${DISPLAY}`; ctx.textAlign = 'center'; ctx.fillText(club.code, 138, 156); ctx.textAlign = 'left'; }
  ctx.font = `800 30px ${SANS}`; ctx.fillStyle = club.color; ctx.fillText(eyebrow.toUpperCase().split('').join(' '), 232, 118);
  const name = fit(ctx, club.name.toUpperCase(), W - 232 - 72, 2, 70, 44, (px) => `italic 900 ${px}px ${DISPLAY}`);
  ctx.fillStyle = '#ffffff';
  name.lines.forEach((l, i) => ctx.fillText(l, 232, 182 + i * name.px * 0.92));
  // the footer
  ctx.fillStyle = 'rgba(255,255,255,.1)'; ctx.fillRect(72, H - 150, W - 144, 2);
  ctx.font = `700 30px ${SANS}`; ctx.fillStyle = '#e2e8f0'; ctx.fillText(club.url.replace(/^https?:\/\//, '').replace(/\/$/, ''), 72, H - 92);
  ctx.font = `italic 900 36px ${DISPLAY}`; ctx.textAlign = 'right'; ctx.fillStyle = '#f7c548'; ctx.fillText('SUPER', W - 72 - ctx.measureText(' POOLS').width, H - 92); ctx.fillStyle = '#ffffff'; ctx.fillText(' POOLS', W - 72, H - 92); ctx.textAlign = 'left';
  ctx.font = `500 24px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillText('Fan zones: every club read like a front office. Free and open, made by fans.', 72, H - 50);
  return 300;
}
const eyebrowAt = (ctx: Ctx, t: string, x: number, y: number, color: string) => { ctx.font = `800 26px ${SANS}`; ctx.fillStyle = color; ctx.fillText(t.toUpperCase().split('').join(' '), x, y); };
function tiles(ctx: Ctx, list: CardTile[], y: number, club: CardClub, cols = 4, h = 150) {
  const gap = 16, w = (W - 144 - gap * (cols - 1)) / cols;
  list.slice(0, cols * 2).forEach((t, i) => {
    const x = 72 + (i % cols) * (w + gap), yy = y + Math.floor(i / cols) * (h + gap);
    ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.beginPath(); ctx.roundRect(x, yy, w, h, 24); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 2; ctx.stroke();
    ctx.font = `700 22px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(fit(ctx, t.k.toUpperCase(), w - 36, 1, 22, 16, (px) => `700 ${px}px ${SANS}`).lines[0], x + 18, yy + 40);
    const v = fit(ctx, t.v, w - 36, 1, 52, 30, (px) => `800 ${px}px ${DISPLAY}`);
    ctx.fillStyle = t.tone === 'good' ? TONE.good : t.tone === 'bad' ? TONE.bad : t.tone === 'club' ? club.color : '#ffffff'; ctx.fillText(v.lines[0], x + 18, yy + 100);
    if (t.sub) { ctx.font = `500 20px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText(fit(ctx, t.sub, w - 36, 1, 20, 14, (px) => `500 ${px}px ${SANS}`).lines[0], x + 18, yy + 132); }
  });
  return y + Math.ceil(Math.min(list.length, cols * 2) / cols) * (h + gap);
}
function ring(ctx: Ctx, x: number, y: number, r: number, pct: number, color: string) {
  ctx.lineWidth = 22; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
  ctx.strokeStyle = color; ctx.beginPath(); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.005, pct)); ctx.stroke();
}
const pct0 = (p: number) => (p >= 0.995 ? '>99%' : p > 0 && p < 0.005 ? '<1%' : `${Math.round(p * 100)}%`);

export async function drawFanCard(c: FanCard): Promise<Blob> {
  // the faces the page already uses, loaded for the canvas; a face that won't come in a moment is drawn without
  await Promise.race([
    Promise.all([`italic 900 70px ${DISPLAY}`, `800 52px ${DISPLAY}`, `900 120px ${DISPLAY}`, `800 30px ${SANS}`, `700 30px ${SANS}`, `600 30px ${SANS}`, `500 26px ${SANS}`].map((f) => document.fonts?.load(f).catch(() => null))),
    new Promise((r) => setTimeout(r, 1500)),
  ]);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  ctx.textBaseline = 'alphabetic';
  const club = c.club;
  let y = await frame(ctx, club, c.eyebrow);

  if (c.kind === 'verdict') {
    // the grade, big, with the read beside it
    ctx.fillStyle = rgba(club.color, 0.22); ctx.beginPath(); ctx.roundRect(72, y, 200, 200, 36); ctx.fill();
    ctx.strokeStyle = rgba(club.color, 0.6); ctx.lineWidth = 3; ctx.stroke();
    ctx.font = `900 ${c.grade.length > 1 ? 96 : 116}px ${DISPLAY}`; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText(c.grade, 172, y + 128);
    ctx.font = `800 20px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText('THE GRADE SO FAR'.split('').join('\u200a'), 172, y + 176); ctx.textAlign = 'left';
    const s = fit(ctx, c.summary, W - 72 - 304, 6, 34, 26, (px) => `600 ${px}px ${SANS}`);
    ctx.fillStyle = '#f1f5f9'; s.lines.forEach((l, i) => ctx.fillText(l, 304, y + 36 + i * s.px * 1.3));
    y += Math.max(260, 36 + s.lines.length * s.px * 1.3 + 40);
    const col = (title: string, rows: { label: string; rank: string }[], x: number, color: string) => {
      eyebrowAt(ctx, title, x, y, color);
      rows.slice(0, 4).forEach((r, i) => {
        const yy = y + 40 + i * 74;
        ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.roundRect(x, yy, 452, 60, 18); ctx.fill();
        ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, yy, 8, 60, 4); ctx.fill();
        ctx.font = `600 26px ${SANS}`; ctx.fillStyle = '#e2e8f0'; ctx.fillText(fit(ctx, r.label, 320, 1, 26, 20, (px) => `600 ${px}px ${SANS}`).lines[0], x + 24, yy + 39);
        ctx.font = `800 30px ${DISPLAY}`; ctx.fillStyle = color; ctx.textAlign = 'right'; ctx.fillText(r.rank, x + 436, yy + 41); ctx.textAlign = 'left';
      });
      if (!rows.length) { ctx.font = `500 24px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillText('Nothing at the end of the table', x, y + 76); }
    };
    col('Strengths', c.strengths, 72, TONE.good); col('Weaknesses', c.weaknesses, 556, TONE.bad);
    y += 40 + 4 * 74 + 20;
    if (c.luck) {
      const l = fit(ctx, c.luck, W - 144 - 40, 3, 26, 22, (px) => `500 ${px}px ${SANS}`);
      ctx.fillStyle = 'rgba(255,255,255,.05)'; ctx.beginPath(); ctx.roundRect(72, y, W - 144, l.lines.length * l.px * 1.3 + 36, 22); ctx.fill();
      ctx.fillStyle = '#cbd5e1'; l.lines.forEach((t, i) => ctx.fillText(t, 92, y + 38 + i * l.px * 1.3));
    }
    ctx.font = `700 26px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.textAlign = 'right'; ctx.fillText(c.record, W - 72, 280); ctx.textAlign = 'left';
  } else if (c.kind === 'outlook') {
    // the headline chance as a ring
    ring(ctx, 72 + 150, y + 150, 128, c.headline.pct, club.color);
    ctx.font = `900 ${c.headline.pct >= 0.995 || c.headline.pct < 0.005 ? 72 : 96}px ${DISPLAY}`; ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText(pct0(c.headline.pct), 222, y + 184); ctx.textAlign = 'left';
    eyebrowAt(ctx, c.headline.label, 420, y + 60, club.color);
    ctx.font = `800 40px ${DISPLAY}`; ctx.fillStyle = '#ffffff'; ctx.fillText(fit(ctx, `${c.projected.mid} ${c.projected.label}`, W - 72 - 420, 1, 40, 28, (px) => `800 ${px}px ${DISPLAY}`).lines[0], 420, y + 118);
    ctx.font = `500 26px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(c.projected.range, 420, y + 158);
    if (c.record) { ctx.font = `700 26px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText(c.record, 420, y + 206); }
    if (c.line) {
      const l = fit(ctx, c.line, W - 72 - 420, 3, 24, 20, (px) => `500 ${px}px ${SANS}`);
      ctx.fillStyle = '#cbd5e1'; l.lines.forEach((t, i) => ctx.fillText(t, 420, y + 250 + i * l.px * 1.3));
    }
    y += 340;
    y = tiles(ctx, c.tiles, y, club, 2, 160);
    ctx.font = `500 22px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.45)'; ctx.fillText('The rest of the season played out a few thousand times from every club’s numbers.', 72, Math.min(H - 180, y + 36));
  } else if (c.kind === 'history') {
    const t = c.titles;
    ctx.font = `900 150px ${DISPLAY}`; ctx.fillStyle = club.color; ctx.fillText(String(t.count), 72, y + 130);
    const nw = ctx.measureText(String(t.count)).width;
    const label = fit(ctx, t.label, W - 72 - (72 + nw + 24), 2, 44, 30, (px) => `800 ${px}px ${DISPLAY}`);
    ctx.fillStyle = '#ffffff'; label.lines.forEach((l, i) => ctx.fillText(l, 72 + nw + 24, y + 78 + i * label.px * 0.95));
    y += 160;
    // the years as chips
    let x = 72, row = 0;
    ctx.font = `700 24px ${SANS}`;
    for (const yr of t.years) {
      const s = String(yr), w = ctx.measureText(s).width + 36;
      if (x + w > W - 72) { x = 72; row++; if (row > 2) break; }
      const yy = y + row * 54;
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.roundRect(x, yy, w, 44, 22); ctx.fill();
      ctx.fillStyle = '#f1f5f9'; ctx.fillText(s, x + 18, yy + 30);
      x += w + 10;
    }
    if (t.years.length) y += Math.min(row, 2) * 54 + 70;
    y = tiles(ctx, c.tiles, y, club, 2, 150);
    y += 10;
    for (const line of c.lines.slice(0, 4)) {
      const l = fit(ctx, line, W - 144 - 40, 2, 26, 20, (px) => `500 ${px}px ${SANS}`);
      if (y + l.lines.length * 34 > H - 180) break;
      ctx.fillStyle = club.color; ctx.beginPath(); ctx.arc(84, y + 12, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e2e8f0'; l.lines.forEach((tx, i) => ctx.fillText(tx, 108, y + 22 + i * l.px * 1.3));
      y += l.lines.length * l.px * 1.3 + 22;
    }
  } else if (c.kind === 'calls') {
    eyebrowAt(ctx, `${c.who}’s calls for the season`, 72, y, 'rgba(255,255,255,.6)');
    y += 30;
    const rows = c.rows.slice(0, 7), rh = rows.length <= 4 ? 150 : rows.length <= 5 ? 128 : 112;
    rows.forEach((r, i) => {
      const yy = y + i * rh;
      ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.roundRect(72, yy, W - 144, rh - 14, 24); ctx.fill();
      ctx.fillStyle = club.color; ctx.beginPath(); ctx.roundRect(72, yy, 10, rh - 14, 5); ctx.fill();
      ctx.font = `600 22px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(fit(ctx, r.title, 600, 1, 22, 18, (px) => `600 ${px}px ${SANS}`).lines[0], 104, yy + 38);
      const a = fit(ctx, r.mine, 640, 1, rh >= 128 ? 46 : 38, 26, (px) => `800 ${px}px ${DISPLAY}`);
      ctx.fillStyle = '#ffffff'; ctx.fillText(a.lines[0], 104, yy + (rh >= 128 ? 94 : 82));
      if (r.agree != null) {
        ctx.textAlign = 'right';
        ctx.font = `900 ${rh >= 128 ? 56 : 44}px ${DISPLAY}`; ctx.fillStyle = r.agree >= 0.5 ? TONE.good : '#f1f5f9'; ctx.fillText(pct0(r.agree), W - 100, yy + (rh >= 128 ? 80 : 68));
        ctx.font = `600 20px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText('of fans agree', W - 100, yy + (rh >= 128 ? 112 : 94));
        ctx.textAlign = 'left';
      }
    });
    y += rows.length * rh + 10;
    ctx.font = `500 24px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillText('Make yours: one call each, open to every fan.', 72, Math.min(H - 180, y + 20));
  } else if (c.kind === 'pulse') {
    ctx.font = `900 120px ${DISPLAY}`; ctx.fillStyle = club.color; ctx.fillText(String(c.people), 72, y + 100);
    const nw = ctx.measureText(String(c.people)).width;
    ctx.font = `800 40px ${DISPLAY}`; ctx.fillStyle = '#ffffff'; ctx.fillText(c.people === 1 ? 'FAN HAS HAD THEIR SAY' : 'FANS HAVE HAD THEIR SAY', 72 + nw + 24, y + 62);
    ctx.font = `500 26px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(`The ${c.season} season, so far`, 72 + nw + 24, y + 100);
    y += 150;
    const rows = c.rows.slice(0, 5), rh = rows.length <= 3 ? 170 : rows.length <= 4 ? 150 : 128;
    rows.forEach((r, i) => {
      const yy = y + i * rh;
      ctx.font = `600 22px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.fillText(fit(ctx, r.title, 700, 1, 22, 18, (px) => `600 ${px}px ${SANS}`).lines[0], 72, yy + 26);
      const a = fit(ctx, r.top, 760, 1, rh >= 150 ? 44 : 36, 26, (px) => `800 ${px}px ${DISPLAY}`);
      ctx.fillStyle = '#ffffff'; ctx.fillText(a.lines[0], 72, yy + (rh >= 150 ? 78 : 68));
      ctx.textAlign = 'right'; ctx.font = `900 ${rh >= 150 ? 56 : 46}px ${DISPLAY}`; ctx.fillStyle = club.color; ctx.fillText(pct0(r.pct), W - 72, yy + (rh >= 150 ? 76 : 66));
      ctx.font = `500 20px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.5)'; ctx.fillText(`${r.n} call${r.n === 1 ? '' : 's'}`, W - 72, yy + (rh >= 150 ? 104 : 92)); ctx.textAlign = 'left';
      const by = yy + (rh >= 150 ? 110 : 90);
      ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.beginPath(); ctx.roundRect(72, by, W - 144, 12, 6); ctx.fill();
      ctx.fillStyle = club.color; ctx.beginPath(); ctx.roundRect(72, by, Math.max(14, (W - 144) * r.pct), 12, 6); ctx.fill();
    });
    if (!rows.length) { ctx.font = `600 30px ${SANS}`; ctx.fillStyle = '#e2e8f0'; ctx.fillText('No calls yet. Be the first to have your say.', 72, y + 60); }
  } else if (c.kind === 'post') {
    ctx.font = `80px ${SANS}`; ctx.fillText(c.emoji, 72, y + 70);
    const t = fit(ctx, c.title, W - 144, 4, 64, 40, (px) => `800 ${px}px ${DISPLAY}`);
    ctx.fillStyle = '#ffffff'; t.lines.forEach((l, i) => ctx.fillText(l, 72, y + 160 + i * t.px * 1.02));
    y += 160 + t.lines.length * t.px * 1.02 + 20;
    if (c.body) {
      const b = fit(ctx, c.body, W - 144, 8, 30, 24, (px) => `500 ${px}px ${SANS}`);
      ctx.fillStyle = '#cbd5e1'; b.lines.forEach((l, i) => ctx.fillText(l, 72, y + 20 + i * b.px * 1.35));
      y += b.lines.length * b.px * 1.35 + 50;
    }
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.beginPath(); ctx.roundRect(72, Math.min(y, H - 330), W - 144, 110, 24); ctx.fill();
    const yy = Math.min(y, H - 330);
    ctx.font = `700 28px ${SANS}`; ctx.fillStyle = '#ffffff'; ctx.fillText(`By ${c.author}`, 100, yy + 48);
    ctx.font = `500 22px ${SANS}`; ctx.fillStyle = 'rgba(255,255,255,.55)'; ctx.fillText('on the fan board', 100, yy + 82);
    ctx.textAlign = 'right'; ctx.font = `900 56px ${DISPLAY}`; ctx.fillStyle = c.score >= 0 ? TONE.good : TONE.bad; ctx.fillText(`${c.score >= 0 ? '+' : ''}${c.score}`, W - 100, yy + 72); ctx.textAlign = 'left';
  } else if (c.kind === 'question') {
    const tone = c.verdict === 'Rethink' ? TONE.bad : c.verdict === 'Adjust' ? '#fbbf24' : TONE.good;
    ctx.font = `800 28px ${SANS}`; const vw = ctx.measureText(c.verdict.toUpperCase()).width + 44;
    ctx.fillStyle = rgba(tone, 0.2); ctx.beginPath(); ctx.roundRect(72, y - 10, vw, 54, 27); ctx.fill();
    ctx.fillStyle = tone; ctx.fillText(c.verdict.toUpperCase(), 94, y + 27);
    const t = fit(ctx, c.title, W - 144, 3, 60, 40, (px) => `800 ${px}px ${DISPLAY}`);
    ctx.fillStyle = '#ffffff'; t.lines.forEach((l, i) => ctx.fillText(l, 72, y + 130 + i * t.px * 1.0));
    y += 130 + t.lines.length * t.px + 24;
    for (const e of c.evidence.slice(0, 4)) {
      const l = fit(ctx, e, W - 144 - 40, 2, 26, 20, (px) => `500 ${px}px ${SANS}`);
      ctx.fillStyle = club.color; ctx.beginPath(); ctx.arc(84, y + 12, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e2e8f0'; l.lines.forEach((tx, i) => ctx.fillText(tx, 108, y + 22 + i * l.px * 1.3));
      y += l.lines.length * l.px * 1.3 + 18;
    }
    y += 10;
    const a = fit(ctx, c.action, W - 144 - 48, 4, 28, 22, (px) => `600 ${px}px ${SANS}`);
    const ah = a.lines.length * a.px * 1.3 + 70;
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.beginPath(); ctx.roundRect(72, y, W - 144, ah, 24); ctx.fill();
    eyebrowAt(ctx, 'What to do', 96, y + 38, club.color);
    ctx.fillStyle = '#f8fafc'; a.lines.forEach((l, i) => ctx.fillText(l, 96, y + 76 + i * a.px * 1.3));
    y += ah + 24;
    if (c.fans && c.fans.n > 0 && y < H - 240) {
      const f = c.fans, parts: [number, string, string][] = [[f.keep, TONE.good, 'keep'], [f.adjust, '#fbbf24', 'adjust'], [f.rethink, TONE.bad, 'rethink']];
      eyebrowAt(ctx, `${f.n} fan${f.n === 1 ? '' : 's'} say`, 72, y + 10, 'rgba(255,255,255,.6)');
      let x = 72;
      for (const [n, color] of parts) { const w = ((W - 144) * n) / f.n; if (w > 0) { ctx.fillStyle = color; ctx.fillRect(x, y + 26, Math.max(0, w - 4), 16); x += w; } }
      x = 72; ctx.font = `600 22px ${SANS}`;
      for (const [n, color, word] of parts) { ctx.fillStyle = color; ctx.fillText(`${Math.round((n / f.n) * 100)}% ${word}`, x, y + 76); x += ctx.measureText(`${Math.round((n / f.n) * 100)}% ${word}`).width + 28; }
    }
  }
  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t draw the card'))), 'image/png'));
}

export async function fanCardJob(card: FanCard, text: string, title: string): Promise<ShareJob> {
  return { blob: await drawFanCard(card), text, url: card.club.url, title, file: `${card.club.code.toLowerCase()}-${card.kind}.png` };
}
