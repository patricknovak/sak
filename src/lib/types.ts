export type Slot = 'C' | 'LW' | 'RW' | 'D' | 'Util' | 'G' | 'BN' | 'IR';
export type Pos = 'C' | 'LW' | 'RW' | 'D' | 'G';

export interface League {
  id: number; name: string; short_name: string; season: string;
  phase: 'keepers' | 'predraft' | 'draft' | 'season' | 'offseason';
  keepers: number; top_scorer_rule: boolean; keeper_deadline: string | null; draft_at: string | null;
  pick_seconds: number; draft_rounds: number; snake: boolean; season_start: string | null; season_end: string | null;
  trade_deadline: string | null; trade_review_hours: number; max_acquisitions: number; extra_acq_fee: number;
  entry_fee: number; sak_fee: number; prize_split: number[]; playoff_share: number; roster: Record<Slot, number>;
  scoring: { skater: Record<string, number>; goalie: Record<string, number> };
  commish_note: string | null; updated_at: string; info: Record<string, any>;
}

export interface Team {
  id: number; name: string; abbrev: string; gm_name: string; login_email: string; user_id: string | null;
  color: string; emoji: string; motto: string | null; fav_nhl: string | null; is_commish: boolean;
  joined_season: string | null; auto_lineup: boolean; autodraft: boolean; keepers_submitted: boolean; last_seen: string | null;
  auto_mode: 'off' | 'day' | 'week' | 'season'; auto_basis: 'proj' | 'form' | 'season' | 'ros'; lineup_touched: string | null;
  role: 'gm' | 'spectator'; perms: Record<string, boolean>;   // spectators: {chat, dm, bets, ideas, active}, missing = allowed
}

export interface Player {
  id: number; name: string; first: string | null; last_name: string | null; pos: Pos; elig: string[];
  nhl_team: string | null; num: number | null; headshot: string | null; last_fp: number; proj: number;
  rank: number | null; status: string; last_stats: Record<string, number> | null; injury_note: string | null;
  injury_status: string | null; injury_date: string | null;
}

export interface Roster {
  player_id: number; team_id: number; slot: Slot; acquired: string; acquired_at: string; keeper: boolean; prev_fp: number | null;
  pin: 'start' | 'bench' | null;
}

export interface DraftPick {
  id: number; season: string; round: number; original_team: number; team_id: number; overall: number | null;
  player_id: number | null; picked_at: string | null; auto: boolean;
}

export interface DraftState {
  id: number; season: string; status: 'scheduled' | 'live' | 'paused' | 'done'; current_overall: number | null;
  deadline: string | null; paused_remaining: number | null; order_set: boolean; started_at: string | null;
}

export interface Message {
  id: number; channel: string; team_id: number | null; kind: 'user' | 'system' | 'bot'; body: string;
  meta: Record<string, unknown> | null; reply_to: number | null; created_at: string; edited_at: string | null; deleted: boolean;
}

export interface Reaction { message_id: number; team_id: number; emoji: string }

export interface Game {
  id: number; date: string; start_utc: string; home: string; away: string; state: string;
  home_score: number | null; away_score: number | null; period: string | null; clock: string | null;
}

export interface Standing {
  team_id: number; points: number; today: number; yesterday: number; last7: number; games: number; rank: number; moves: number;
}

export interface PlayerWindow { player_id: number; win: string; gp: number; fpts: number; totals: Record<string, number> }
export interface PlayerSeason { player_id: number; gp: number; fpts: number; fpts14: number | null; gp14: number | null; totals: Record<string, number | null> }

export interface Trade {
  id: number; season: string; from_team: number; to_team: number;
  status: 'proposed' | 'accepted' | 'approved' | 'declined' | 'cancelled' | 'vetoed' | 'failed';
  note: string | null; review_note: string | null; created_at: string; responded_at: string | null; decided_at: string | null;
  parties: number[] | null; accepted_by: number[];   // multi-team trades list every team; two-team trades have parties = null
  trade_items?: TradeItem[];
}
export interface TradeItem { id: number; trade_id: number; from_team: number; to_team: number | null; player_id: number | null; pick_id: number | null }

export interface Bet {
  id: number; creator_team: number; opponent_team: number | null; title: string; terms: string | null;
  kind: 'custom' | 'h2h' | 'season'; stake: string | null; amount: number | null; start_date: string | null; end_date: string | null;
  status: 'open' | 'accepted' | 'declined' | 'cancelled' | 'settled'; proposed_winner: number | null; proposed_by: number | null;
  winner_team: number | null; paid: boolean; coins: number; created_at: string; accepted_at: string | null; settled_at: string | null;
}

export interface Proposal {
  id: number; title: string; body: string | null; sponsor_team: number | null; cosponsor_team: number | null;
  status: 'open' | 'passed' | 'failed' | 'vetoed' | 'tabled'; created_at: string; closes_at: string | null;
}
export interface Vote { proposal_id: number; team_id: number; vote: 'yes' | 'no' | 'abstain' }

export interface Transaction {
  id: number; season: string; type: string; team_id: number | null; player_id: number | null; other_team: number | null;
  fee: number; note: string | null; created_at: string;
}

export interface Notification { id: number; team_id: number; kind: string; body: string; link: string | null; read: boolean; created_at: string }

export interface LedgerRow { id: number; season: string; team_id: number | null; kind: string; amount: number; description: string; paid: boolean; created_at: string }

export interface CoinBalance { team_id: number; balance: number; escrow: number }
export interface CoinEntry { id: number; team_id: number; amount: number; reason: string; bet_id: number | null; created_at: string }
export interface NewsItem { id: string; headline: string; description: string | null; published: string | null; url: string | null; image: string | null; player_ids: number[] }
