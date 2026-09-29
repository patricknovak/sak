// Game-day status: will he play tonight? Pure TypeScript (no Deno or DOM APIs), shared by the sync and the site.
//
//   goalies   confirmed / expected starter from ESPN's probable goalies; his crease partners are the backup
//   injuries  anyone on the injury report whose team plays: out (IR, Out, suspended) or a game-time decision
//   scratches once his team's game starts, a rostered player missing from the box score was scratched
export type GameStatus = 'confirmed' | 'expected' | 'backup' | 'gtd' | 'out' | 'scratched';

export interface StatusRow { player_id: number; date: string; status: GameStatus; note: string | null; opponent: string | null }

export const STATUS_LABEL: Record<GameStatus, string> = {
  confirmed: 'Starting', expected: 'Probable starter', backup: 'Backup', gtd: 'Game-time call', out: 'Out', scratched: 'Scratched',
};

// the chance he's in the lineup tonight, given his status (null = no information, use the usual estimate)
export function statusChance(s: GameStatus | null | undefined): number | null {
  switch (s) {
    case 'confirmed': return 1;
    case 'expected': return 0.88;
    case 'backup': return 0.04;
    case 'out': case 'scratched': return 0;
    default: return null;   // gtd: the injury weighting already halves it
  }
}

const OUT = /^(out|ir|injured|long|suspen)/i;

export function mergeStatus(input: {
  date: string;
  games: { home: string; away: string }[];
  probables: { team: string; playerId: number; status: 'confirmed' | 'expected'; name: string }[];
  goalies: { id: number; team: string }[];
  injured: { id: number; team: string; status: string; note: string | null }[];
  scratched: { id: number; team: string }[];
}): StatusRow[] {
  const opp = new Map<string, string>();
  for (const g of input.games) { opp.set(g.home, `vs ${g.away}`); opp.set(g.away, `@ ${g.home}`); }
  const out = new Map<number, StatusRow>();
  const put = (id: number, team: string, status: GameStatus, note: string | null) => {
    if (!opp.has(team)) return;
    out.set(id, { player_id: id, date: input.date, status, note, opponent: opp.get(team)! });
  };
  const startedBy = new Map<string, { name: string; status: string }>();
  for (const p of input.probables) {
    put(p.playerId, p.team, p.status, p.status === 'confirmed' ? 'Confirmed starter' : 'Expected to start');
    startedBy.set(p.team, { name: p.name, status: p.status });
  }
  for (const g of input.goalies) {
    const s = startedBy.get(g.team);
    if (s && !out.has(g.id)) put(g.id, g.team, 'backup', `${s.name} ${s.status === 'confirmed' ? 'is confirmed' : 'is expected'} to start`);
  }
  for (const i of input.injured) {
    const cur = out.get(i.id);
    const isOut = OUT.test(i.status);
    const note = i.note ? `${i.status}: ${i.note}` : i.status;
    if (isOut) put(i.id, i.team, 'out', note);
    else if (!cur || cur.status === 'backup') put(i.id, i.team, cur?.status === 'backup' ? 'backup' : 'gtd', cur?.status === 'backup' ? `${cur.note} · ${note}` : note);
    else cur.note = `${cur.note} · ${note}`;   // a goalie confirmed to start through a day-to-day tag plays
  }
  for (const s of input.scratched) put(s.id, s.team, 'scratched', 'Not in the lineup');
  return [...out.values()];
}
