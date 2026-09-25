// Plays draft sounds off the shared draft state: a sting (or the horn for you) when a pick lands, ticks under
// ten seconds while someone is on the clock, a buzzer at zero. Also the toggle button.
import { useEffect, useRef, useState } from 'react';
import { useLeague, useNow } from '../lib/store';
import { buzzer, horn, setSounds, sting, soundsOn, tick, unlockAudio } from '../lib/sounds';
import { Volume2, VolumeX } from 'lucide-react';

export function useDraftSounds(on: boolean, opts: { everyone?: boolean } = {}) {
  const { me, picks, draft } = useLeague();
  const now = useNow(250);
  const made = picks.filter((p) => p.season === draft?.season && p.player_id).length;
  const current = picks.find((p) => p.overall === draft?.current_overall && p.season === draft?.season);
  const mine = draft?.status === 'live' && !!current && current.team_id === me?.id;
  const remaining = draft?.status === 'live' && draft.deadline ? new Date(draft.deadline).getTime() - now : Infinity;
  const lastMade = useRef(made);
  const lastSec = useRef<number | null>(null);
  const buzzed = useRef<number | null>(null);
  useEffect(() => {
    if (made > lastMade.current && on) {
      const latest = [...picks].filter((p) => p.player_id && p.season === draft?.season).sort((a, b) => b.overall! - a.overall!)[0];
      if (latest?.team_id === me?.id || opts.everyone) horn(latest?.overall === 1); else sting();
    }
    lastMade.current = made;
  }, [made]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!on || draft?.status !== 'live' || !(mine || opts.everyone)) { lastSec.current = null; return; }
    const sec = Math.ceil(remaining / 1000);
    if (sec <= 10 && sec >= 1 && sec !== lastSec.current) { lastSec.current = sec; tick(sec <= 3); }
    if (sec <= 0 && buzzed.current !== current?.overall) { buzzed.current = current?.overall ?? null; buzzer(); }
  }, [remaining, on, mine, draft?.status, current?.overall, opts.everyone]);
}

export function SoundToggle({ fallback = false, className = '' }: { fallback?: boolean; className?: string }) {
  const [on, setOn] = useState(() => soundsOn(fallback));
  return (
    <button className={`btn-ghost btn-sm ${className}`} title={on ? 'Sounds on' : 'Sounds off'} aria-pressed={on}
      onClick={() => { unlockAudio(); setSounds(!on); setOn(!on); if (!on) sting(); }}>
      {on ? <Volume2 size={16} /> : <VolumeX size={16} />}<span className="hidden sm:inline">{on ? 'Sound on' : 'Sound off'}</span>
    </button>
  );
}
export const useSoundsOn = (fallback = false) => {
  const [on, setOn] = useState(() => soundsOn(fallback));
  useEffect(() => {
    const i = window.setInterval(() => setOn(soundsOn(fallback)), 1000);
    return () => window.clearInterval(i);
  }, [fallback]);
  return on;
};
