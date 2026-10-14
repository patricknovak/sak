// chatFilter: the one chat feed's kinds (14 October 2026). Each line is sorted by who wrote it, its channel, its meta
// and the mark it starts with, the way the league's own lines are written (SaK's real lines, checked 14 October);
// one GM's view finds them by their posts, their DMs, and the league lines that name their team or them.
import assert from 'node:assert/strict';
import { aboutGm, chatKinds, chatMatch } from '../../src/lib/chatFilter.ts';

let id = 0;
const m = (body, o = {}) => ({ id: ++id, channel: 'general', team_id: null, kind: 'system', body, meta: null, reply_to: null, created_at: '2026-10-14T00:00:00Z', edited_at: null, deleted: false, ...o });
const k = (x) => [...chatKinds(x)].sort().join('+');

// talk, the voice, private lines
assert.equal(k(m('Fleeced. Absolutely', { kind: 'user', team_id: 5 })), 'talk');
assert.equal(k(m('@Craig, three starters sit tonight', { kind: 'bot', meta: { bot: 'garry' } })), 'garry');
assert.equal(k(m('Garry, who should I pick up?', { kind: 'user', team_id: 1, channel: 'garry:1' })), 'garry+private+talk');
assert.equal(k(m('nice work on the pool', { kind: 'user', team_id: 2, channel: 'dm:1-2' })), 'private+talk');
assert.equal(k(m('📊 The Hip Czechs started a poll: Should we keep this?', { meta: { poll: 3 } })), 'talk');
// transactions
for (const b of ['➕ Ravens add Vince Dunn (D · SEA), drop Mike Matheson (D · MTL)', '➖ The Hip Czechs drop Rasmus Andersson (D · VGK)',
  '🔄 TRADE! Jays send Mark Stone to Ravens for Zach Hyman', '🤝 Jays and Ravens agreed to a trade. Pending the commissioner',
  '🔒 Jays locked in 6 keepers.', '📋 Keepers are final! Everyone else is back in the pool.', '🔁 Commish keeper change: Terry keeps Roman Josi',
  '🚫 Commissioner vetoed the Jays ↔ Ravens trade.', '🛠️ Commissioner moved Zach Hyman to IR'])
  assert.equal(k(m(b)), 'moves', b);
assert.equal(k(m('📣 Jays trade block. Available: Mark Stone', { meta: { trade_block: 1 } })), 'moves');
// bets
for (const b of ['🎲 Hatrick Swayze posted an open challenge: "finishes top 3" · stakes: 100', '✅ Bet on! Jays vs Ravens: "Most points"',
  '🏆 Jays wins the bet "Most points tonight" (31.2 to 28.4) · collect: 50', '⚖️ Commissioner ruling: Jays wins "Most points"',
  '🎰 Jays is in the pool "Top SaK team this week" (2 in, 100 in the pot)', '📖 Book settled 3 markets: Jays +23', "🏒 The Book's NHL board is open",
  '🔮 The Book, season edition: futures on the champion', '🐔 Ravens declined Jays\'s bet: "Most points"', '🤝 Push: "Most points" ended dead even. Coins back'])
  assert.equal(k(m(b)), 'bets', b);
// the draft room's lines are the draft, never transactions or bets, wherever they land
assert.equal(k(m('🚨 1.01 (#1) Eagle Palace select Connor McDavid (C · EDM)', { channel: 'draft', meta: { pick: 1, team: 3 } })), 'draft');
assert.equal(k(m('🎲 Draft order set: 1. Eagle Palace 2. Jays', { channel: 'draft', meta: { order: [3, 2] } })), 'draft');
assert.equal(k(m('🚨 REACH!', { kind: 'user', team_id: 3, channel: 'draft' })), 'draft+talk');
// anything else the league says is league news
assert.equal(k(m('🍿 Dan Perra joins the barn as a spectator.')), 'news');
assert.equal(k(m('🏁 The draft is complete! Rosters are live.')), 'news');

// one GM: their posts, their DMs, a league line that names their team, the voice @ing them; not another GM's post
const jason = { id: 3, name: 'Jays', gm_name: 'Jason' };
assert.ok(aboutGm(m('LFG', { kind: 'user', team_id: 3 }), jason));
assert.ok(!aboutGm(m('Jays are cooked', { kind: 'user', team_id: 2 }), jason));
assert.ok(aboutGm(m('hey', { kind: 'user', team_id: 1, channel: 'dm:1-3' }), jason));
assert.ok(!aboutGm(m('hey', { kind: 'user', team_id: 1, channel: 'dm:1-2' }), jason));
assert.ok(aboutGm(m('➕ Jays add Elias Pettersson (C · VAN)'), jason));
assert.ok(aboutGm(m('@Jason, Morrissey is out', { kind: 'bot' }), jason));
assert.ok(!aboutGm(m('@Jasonville is not a GM', { kind: 'bot' }), jason));
assert.ok(chatMatch(m('➕ Jays add Elias Pettersson (C · VAN)'), 'moves', jason));
assert.ok(!chatMatch(m('➕ Ravens add Vince Dunn (D · SEA)'), 'moves', jason));
assert.ok(!chatMatch(m('LFG', { kind: 'user', team_id: 3 }), 'moves', jason));
console.log('chat filter tests passed');
