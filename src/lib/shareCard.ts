// Share cards for prediction pools (docs/POOLS.md section 6: "share cards after every drop"): a picture a member posts
// to the group chat (my call, the call that came in, the standings), drawn on the phone in the pool's own colours, so
// it costs nothing to make and nothing leaves the device until the member shares it. 1080 x 1350, the shape every chat
// and story shows whole.
export interface CardBrand { wordmark: { a: string; b: string }; color: string; coin: { name: string; emoji: string }; pool: string }
export type ShareCard =
  | { kind: 'call'; brand: CardBrand; who: string; question: string; answer: string; answerColor: string; chance: number; pays: number; staked: number }
  | { kind: 'won'; brand: CardBrand; who: string; question: string; answer: string; answerColor: string; won: number; staked: number }
  | { kind: 'leaders'; brand: CardBrand; title: string; rows: { name: string; worth: number; color: string; me?: boolean }[] };

const W = 1080, H = 1350;
const DISPLAY = "'Barlow Condensed', 'Inter', system-ui, sans-serif", SANS = "'Inter', system-ui, sans-serif";

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number) {
  const out: string[] = []; let line = '';
  for (const w of text.split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > max && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
// the biggest size at which the text fits in the lines it is allowed
function fit(ctx: CanvasRenderingContext2D, text: string, max: number, lines: number, from: number, to: number, font: (px: number) => string) {
  for (let px = from; px >= to; px -= 4) { ctx.font = font(px); const l = wrap(ctx, text, max); if (l.length <= lines) return { px, lines: l }; }
  ctx.font = font(to); const l = wrap(ctx, text, max);
  return { px: to, lines: l.length > lines ? [...l.slice(0, lines - 1), `${l.slice(lines - 1).join(' ').slice(0, 40)}…`] : l };
}
const n = (x: number) => Math.round(x).toLocaleString();

export async function drawCard(c: ShareCard): Promise<Blob> {
  // a canvas only draws with a font that has loaded, and the page may not have used these weights yet
  await Promise.all([`italic 800 76px ${DISPLAY}`, `800 40px ${DISPLAY}`, `900 96px ${DISPLAY}`, `800 34px ${SANS}`, `700 34px ${SANS}`, `600 34px ${SANS}`]
    .map((f) => document.fonts?.load(f).catch(() => null)));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const col = c.brand.color;
  // the night: deep navy, the pool's colour glowing in from the top corner
  ctx.fillStyle = '#070c18'; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(W * 0.15, 0, 40, W * 0.15, 0, 900); g.addColorStop(0, `${col}66`); g.addColorStop(1, `${col}00`);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W, H, 40, W, H, 800); g.addColorStop(0, '#38bdf833'); g.addColorStop(1, '#38bdf800');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // the pool's wordmark
  ctx.textBaseline = 'alphabetic';
  ctx.font = `italic 800 76px ${DISPLAY}`; ctx.fillStyle = col; ctx.fillText(c.brand.wordmark.a.toUpperCase(), 80, 150);
  const aw = ctx.measureText(c.brand.wordmark.a.toUpperCase()).width;
  ctx.font = `800 40px ${DISPLAY}`; ctx.fillStyle = '#ffffffcc'; ctx.fillText(c.brand.wordmark.b.toUpperCase(), 80 + aw + 18, 150);

  const eyebrow = (t: string, y: number, color = col) => { ctx.font = `800 34px ${SANS}`; ctx.fillStyle = color; ctx.fillText(t.toUpperCase().split('').join(String.fromCharCode(8202)), 80, y); };

  if (c.kind === 'leaders') {
    eyebrow(c.title, 270);
    const rows = c.rows.slice(0, 6);
    rows.forEach((r, i) => {
      const y = 330 + i * 140;
      ctx.fillStyle = r.me ? `${col}2e` : '#ffffff0d';
      ctx.beginPath(); ctx.roundRect(60, y, W - 120, 118, 28); ctx.fill();
      ctx.font = `900 64px ${DISPLAY}`; ctx.fillStyle = i === 0 ? col : '#ffffff99'; ctx.fillText(String(i + 1), 100, y + 82);
      ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(205, y + 59, 26, 0, Math.PI * 2); ctx.fill();
      const name = fit(ctx, r.name, 470, 1, 50, 34, (px) => `700 ${px}px ${SANS}`);
      ctx.fillStyle = '#ffffff'; ctx.fillText(name.lines[0], 252, y + 76);
      ctx.font = `800 52px ${DISPLAY}`; ctx.fillStyle = i === 0 ? col : '#ffffffdd'; ctx.textAlign = 'right';
      ctx.fillText(`${c.brand.coin.emoji} ${n(r.worth)}`, W - 100, y + 78); ctx.textAlign = 'left';
    });
  } else {
    eyebrow(c.kind === 'call' ? (c.who ? `${c.who}’s call` : 'My call') : (c.who ? `${c.who} called it` : 'Called it'), 270, c.kind === 'won' ? '#34d399' : col);
    const q = fit(ctx, c.question, W - 160, 4, 84, 52, (px) => `800 ${px}px ${DISPLAY}`);
    ctx.fillStyle = '#ffffff';
    q.lines.forEach((l, i) => ctx.fillText(l, 80, 370 + i * q.px * 1.02));
    let y = 370 + q.lines.length * q.px * 1.02 + 50;
    // the answer, in its colour, on a lit bar
    ctx.fillStyle = `${c.answerColor}26`; ctx.beginPath(); ctx.roundRect(60, y, W - 120, 150, 34); ctx.fill();
    ctx.fillStyle = c.answerColor; ctx.beginPath(); ctx.roundRect(60, y, 16, 150, 8); ctx.fill();
    const a = fit(ctx, (c.kind === 'won' ? '✓ ' : '') + c.answer, W - 220, 1, 76, 40, (px) => `800 ${px}px ${DISPLAY}`);
    ctx.fillStyle = c.answerColor; ctx.fillText(a.lines[0], 110, y + 75 + a.px * 0.35);
    y += 210;
    const stat = (label: string, value: string, x: number, color = '#ffffff') => {
      ctx.font = `700 30px ${SANS}`; ctx.fillStyle = '#ffffff88'; ctx.fillText(label.toUpperCase(), x, y);
      ctx.font = `900 96px ${DISPLAY}`; ctx.fillStyle = color; ctx.fillText(value, x, y + 100);
    };
    if (c.kind === 'call') {
      stat('Called at', `${Math.round(c.chance * 100)}%`, 80, c.answerColor);
      stat('Pays if right', `${c.brand.coin.emoji} ${n(c.pays)}`, 560);
      ctx.font = `600 34px ${SANS}`; ctx.fillStyle = '#ffffffaa';
      ctx.fillText(`${n(c.staked)} ${c.brand.coin.name.toLowerCase()} in${c.staked > 0 ? `, ${(c.pays / c.staked).toFixed(1)}× back if it hits` : ''}`, 80, y + 170);
    } else {
      stat('Won', `${c.brand.coin.emoji} ${n(c.won)}`, 80, '#34d399');
      if (c.staked > 0) stat('Return', `${(c.won / c.staked).toFixed(1)}×`, 620);
    }
  }

  // the footer: the pool and where it lives
  ctx.fillStyle = '#ffffff14'; ctx.fillRect(80, H - 170, W - 160, 2);
  ctx.font = `700 34px ${SANS}`; ctx.fillStyle = '#ffffffdd'; ctx.fillText(fit(ctx, c.brand.pool, 620, 1, 34, 26, (px) => `700 ${px}px ${SANS}`).lines[0], 80, H - 100);
  ctx.font = `800 34px ${DISPLAY}`; ctx.fillStyle = '#f7c548'; ctx.textAlign = 'right'; ctx.fillText('SUPER POOLS', W - 80, H - 100); ctx.textAlign = 'left';
  ctx.font = `500 26px ${SANS}`; ctx.fillStyle = '#ffffff66'; ctx.fillText('Coins only, never money · superpoolsai.com', 80, H - 60);

  return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Couldn’t draw the card'))), 'image/png'));
}

// share the picture (and a line of text) to the group chat; where the phone can't share pictures, save it instead
export async function shareCard(card: ShareCard, text: string, url?: string) {
  const blob = await drawCard(card);
  const file = new File([blob], 'super-pools.png', { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.share && nav.canShare?.({ files: [file] })) {
    await nav.share({ files: [file], text: url ? `${text} ${url}` : text }).catch(() => {});
    return 'shared';
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'super-pools.png';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'saved';
}
