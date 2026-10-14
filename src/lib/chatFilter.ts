import type { Message, Team } from './types';

// The league chat is one feed (14 October 2026, Patrick: "merge all the chat header bar categories into one chat"):
// every message a member can see, the draft room and private lines included, sorted by what it is so a filter can
// show one kind, one GM, or both. Game threads stay beside their game.
export type ChatKind = 'talk' | 'moves' | 'bets' | 'garry' | 'draft' | 'private' | 'news';
export type ChatWhat = ChatKind | 'all';

// the order and the words the filter shows; a pool's chat has no moves, bets or draft, so empty kinds hide
export const CHAT_KINDS: { k: ChatWhat; label: string; icon: string }[] = [
  { k: 'all', label: 'Everything', icon: '💬' },
  { k: 'talk', label: 'Talk', icon: '🔥' },
  { k: 'moves', label: 'Transactions', icon: '🔄' },
  { k: 'bets', label: 'Bets', icon: '🎲' },
  { k: 'garry', label: '{bot}', icon: '🎙️' },
  { k: 'draft', label: 'Draft', icon: '📋' },
  { k: 'private', label: 'Private', icon: '🔒' },
  { k: 'news', label: 'League news', icon: '📰' },
];

// what the league's own lines say they are, by the mark they start with (the SQL writes them, `_sys(...)`)
const MOVES = /^(➕|➖|🔄|🚫|🔁|📣|🛠️|🔒|🛡️ .* co-commissioner)/u;
const MOVES_TEXT = /^(🤝 .*\btrade\b|📋 Keepers)/u;
const BETS = /^(🎲|⚖️|🎰|📖|🐔|🔮|💸)/u;
const BETS_TEXT = /^(✅ Bet on|🏆 .*\b(bet|concedes)\b|🏁 The Book|🏒 The Book|🤝 Push)/u;

export function chatKinds(m: Message): Set<ChatKind> {
  const k = new Set<ChatKind>();
  const meta = m.meta ?? {};
  if (m.channel === 'draft') k.add('draft');
  if (m.channel.startsWith('dm:') || m.channel.startsWith('garry:')) k.add('private');
  if (m.channel.startsWith('garry:') || m.kind === 'bot') k.add('garry');
  if (m.kind === 'user') { k.add('talk'); return k; }
  if (m.kind === 'system') {
    // the draft room's own lines (each pick, the order, the start and the end) are the draft, not transactions
    if (m.channel === 'draft' || 'pick' in meta || 'order' in meta) { if (m.channel !== 'draft') k.add('news'); }
    else if ('poll' in meta) k.add('talk');
    else if ('bet' in meta || 'book' in meta || BETS.test(m.body) || BETS_TEXT.test(m.body)) k.add('bets');
    else if ('trade_block' in meta || MOVES.test(m.body) || MOVES_TEXT.test(m.body)) k.add('moves');
    else k.add('news');
  }
  return k;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// a message is a GM's when they wrote it, it's a private line with them, or the league's line or the voice names
// them (the lines name the team, the voice @s the GM)
export function aboutGm(m: Message, t: Team): boolean {
  if (m.team_id === t.id) return true;
  if (m.channel.startsWith('dm:')) return m.channel.slice(3).split('-').map(Number).includes(t.id);
  if (m.kind === 'user') return false;
  if (m.body.includes(t.name)) return true;
  return new RegExp(`(^|[^\\p{L}])@?${esc(t.gm_name)}(?![\\p{L}])`, 'u').test(m.body);
}

export function chatMatch(m: Message, what: ChatWhat, gm: Team | null): boolean {
  if (what !== 'all' && !chatKinds(m).has(what)) return false;
  return !gm || aboutGm(m, gm);
}
