import { useEffect, useState } from 'react';
import { ProductMark } from '../components/Brand';
import { PRODUCT } from '../lib/brand';
import {
  getAdsConsent,
  getAnalyticsConsent,
  hasGaId,
  setAdsConsent,
  setAnalyticsConsent,
} from '../lib/analytics';

// The privacy note (docs/SUPERPOOLS.md item 14): what the product keeps about a person and why, in plain words, open to
// anyone from the consent banner, the landing page and the sign-in page. It describes what the code does today; when
// the code changes, this page changes in the same pull request.
const SECTIONS: { title: string; body: string[] }[] = [
  { title: 'What we keep', body: [
    'Your name as you gave it, your email address and a password we never see (it is stored hashed by Supabase, which runs our database). The pools and leagues you are in, your team in each, and what you do there: the calls and picks you make, your lineups, your trades, your messages in the pool\'s chat, and the coins you hold. Coins are the pool\'s score, never money.',
    'Your phone\'s push subscription if you turn alerts on, so the pool can tell you when a question is closing or your player scored. Turn them off in your profile and the subscription is deleted.',
  ] },
  { title: 'Who sees it', body: [
    'The people in your pool see your name, your team, your calls and your messages, the way a group chat does. Nobody outside the pool does. We never sell or rent what we keep. There are no ads in Super Pools. We do advertise Super Pools elsewhere, and if you accept Ads measurement, we measure which of those ads led to a sign-up.',
    'The host of a pool can see who has joined and what they have called, and can settle questions and delete the pool. Deleting a pool deletes everything in it.',
  ] },
  { title: 'The NHL fan zones', body: [
    'The fan zones are open to everyone. Joining in takes only a name: your account then lives on the phone you joined on until you add an email. What you post on a club\'s board or knowledge base is public, under your first name and initial, never more, and is part of the fans\' open data. Your calls and votes are never shown one by one, only in the totals. Who wrote, voted or called what is kept apart from the public posts.',
    'You can take your own posts down at any time. A post reported by other fans goes to the fan zones\' editors, and three reports take it down; a copy is kept for the editors.',
  ] },
  { title: 'Analytics', body: [
    'Inside the app we keep a daily count of how often each page of a pool is opened and by how many of its members, with no names: a member is counted by a code that changes every day, so no one\'s visits can be followed. It tells us which pages people use. A pool\'s host can switch it off for the pool.',
    'If you accept Analytics on the banner, we load Google Analytics to count which pools get started, which invite links get shared and which pages get used. We send no names or messages to it. Choosing No thanks turns it off. Your Analytics and Ads choices are stored in your browser and in a cookie on superpoolsai.com so the marketing site and the app remember the same answer. You can change your mind from the banner or the Analytics control on this page.',
  ] },
  { title: 'Ads measurement', body: [
    'If you accept Ads measurement, we load Google\'s Ads tag and send a scrambled one-way code made from your email (never the email itself) so Google Ads can tell whether your sign-up came from one of our ads. We don\'t use it to show you ads or to personalize anything. Choosing No thanks turns it off. Your Analytics and Ads choices are stored in your browser and in a cookie on superpoolsai.com so the marketing site and the app remember the same answer. You can change your mind from the banner or the Ads control on this page. Analytics and Ads are separate choices: you can accept one and refuse the other.',
  ] },
  { title: 'Email and the voice', body: [
    'We send email only to sign you in or reset your password, from no-reply@superpoolsai.com through Resend. We do not send newsletters. The pool\'s voice (the commentary in the chat) is written by a language model from the pool\'s own numbers; a message you send it goes to that model to be answered, with the pool\'s board, and nothing else about you.',
  ] },
  { title: 'Where it lives', body: [
    'The database runs on Supabase and the site on Cloudflare. Scores and schedules come from the leagues\' own public feeds. Nothing about you goes to a league or a sports site.',
  ] },
  { title: 'Your choices', body: [
    'To leave a pool, or to delete your account and everything we keep about you, write to hello@superpoolsai.com from the address you signed up with and it is done within a week. Questions go to the same address.',
  ] },
];

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label}
      onClick={onToggle}
      className={`relative h-8 w-14 shrink-0 rounded-full transition ${on ? 'bg-gold' : 'bg-white/15'}`}>
      <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow transition ${on ? 'left-7' : 'left-1'}`} />
    </button>
  );
}

export default function Privacy() {
  const [analytics, setAnalytics] = useState<'granted' | 'denied' | null>(() => getAnalyticsConsent());
  const [ads, setAds] = useState<'granted' | 'denied' | null>(() => getAdsConsent());
  // Banner Accept writes localStorage in the same tab; re-read so the switches match.
  useEffect(() => {
    const sync = () => {
      setAnalytics(getAnalyticsConsent());
      setAds(getAdsConsent());
    };
    window.addEventListener('sp-consent-change', sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener('sp-consent-change', sync);
      window.removeEventListener('storage', sync);
    };
  }, []);
  const analyticsOn = analytics === 'granted';
  const adsOn = ads === 'granted';
  return (
    <div className="min-h-dvh px-4 pb-16 pt-10" style={{ background: 'radial-gradient(120% 70% at 50% 0%, rgb(var(--gold-rgb)/.16), transparent 60%), #0b1222' }}>
      <div className="mx-auto max-w-xl">
        <div className="text-center">
          <a href="#/" className="mx-auto mb-3 inline-block drop-shadow-[0_10px_30px_rgb(var(--gold-rgb)/.35)]"><ProductMark size={56} /></a>
          <div className="text-[11px] font-bold uppercase tracking-[.22em] text-gold">{PRODUCT.name}</div>
          <h1 className="mt-1 font-display text-[36px] font-extrabold italic leading-[.95] text-white">Your privacy, plainly.</h1>
          <p className="mt-3 text-sm text-mute">A pool is a group of friends and a scoreboard. Here is everything we keep to run one, and nothing else.</p>
        </div>
        {hasGaId() && (
          <div className="mt-6 space-y-3">
            <div className="card flex items-center justify-between gap-3 p-4">
              <div>
                <div className="font-display text-lg font-extrabold text-white">Analytics</div>
                <p className="mt-1 text-sm text-slate-300">{analyticsOn ? 'On. Counts how Super Pools is used.' : 'Off. Google Analytics does not load.'}</p>
              </div>
              <Switch on={analyticsOn} label={`Analytics ${analyticsOn ? 'on' : 'off'}`} onToggle={() => {
                const next = !analyticsOn;
                setAnalyticsConsent(next);
                setAnalytics(next ? 'granted' : 'denied');
              }} />
            </div>
            <div className="card flex items-center justify-between gap-3 p-4">
              <div>
                <div className="font-display text-lg font-extrabold text-white">Ads measurement</div>
                <p className="mt-1 text-sm text-slate-300">{adsOn ? 'On. Hashed email may go to Google Ads for conversion measurement.' : 'Off. No Ads tag and no hashed email.'}</p>
              </div>
              <Switch on={adsOn} label={`Ads measurement ${adsOn ? 'on' : 'off'}`} onToggle={() => {
                const next = !adsOn;
                setAdsConsent(next);
                setAds(next ? 'granted' : 'denied');
              }} />
            </div>
          </div>
        )}
        <div className="mt-8 space-y-4">
          {SECTIONS.map((s) => (
            <section key={s.title} className="card p-4">
              <h2 className="font-display text-lg font-extrabold text-white">{s.title}</h2>
              {s.body.map((b, i) => <p key={i} className="mt-2 text-sm leading-relaxed text-slate-200">{b}</p>)}
            </section>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-mute">Last changed 18 October 2026. © 2026 {PRODUCT.name} · <a className="text-sky-300" href="#/">Back to the app</a></p>
      </div>
    </div>
  );
}
