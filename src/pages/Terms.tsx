import { ProductMark } from '../components/Brand';
import { PRODUCT } from '../lib/brand';

// The terms of use (28 October 2026, the pre-launch review): the rules for using Super Pools, in plain words, beside the
// privacy note and drawn the same way. Like the privacy note it describes what the product does today (coins are a
// score and never money, a host settles their pool, the fan zones' posts are public, the voice is a language model);
// when the product changes, this page changes in the same pull request.
const SECTIONS: { title: string; body: string[] }[] = [
  { title: 'Who can play', body: [
    'You must be at least 13 to use Super Pools, and old enough where you live to agree to these terms yourself. One person, one account: don\'t make extra accounts to get more coins, more seats or more votes.',
    'Keep your password to yourself. If you joined with just a name, your account lives on that phone until you add an email; add one to keep your seat if the phone or its browser is cleared.',
  ] },
  { title: 'Coins are a score, never money', body: [
    'Supercoins, a pool\'s coins and a league\'s coins keep score. They can\'t be bought, sold, traded for anything of value, cashed out or carried out of Super Pools, and they are worth nothing outside the pool they were given in. Nothing in Super Pools asks you to pay to play or to win.',
    'Super Pools never holds, moves or pays out money. If your group plays for something among yourselves (a league\'s dues, a trophy, a dinner), that is between the people in it: Super Pools can keep a record your group writes down, but takes no part in collecting or paying it, and you are responsible for following the law where you live.',
  ] },
  { title: 'Pools, hosts and calls', body: [
    'Whoever starts a pool hosts it. A host invites people, asks and settles questions, can correct a result the feed got wrong, and can delete the pool, which deletes everything in it. A question is settled by the rule written on it when it was asked; the host\'s reason goes on the record. Disagreements about a call are for your group to sort out.',
    'Scores, schedules, injuries and results come from the leagues\' and ESPN\'s public feeds and can be late or wrong. We fix what we can when we know, and a host can settle by hand, but we can\'t promise any number is right at every moment.',
  ] },
  { title: 'What you post', body: [
    'What you write and the photos you share stay yours. You let us store them and show them to the people they\'re meant for: your pool, a lounge you post in, or, on the fan zones, everyone. Posts on a fan zone\'s board and knowledge base are public under your first name and initial and are part of the fans\' open data, which anyone may read and reuse.',
    'Don\'t post anything illegal, hateful, harassing, sexual, violent or threatening, anything that isn\'t yours to share, other people\'s private details, spam or ads. Don\'t pretend to be someone else. A post other fans report three times comes down, and we can remove anything that breaks these rules and close an account that keeps breaking them.',
  ] },
  { title: 'The voice', body: [
    'The pool\'s voice (the commentary and answers in the chat) is written by a language model from the pool\'s own numbers. It can be wrong. The analysis, the chances and the voice are for fun and conversation, not advice of any kind.',
  ] },
  { title: 'The leagues and the shows', body: [
    'Super Pools is not affiliated with or endorsed by the NHL, the NFL, the NBA, MLB, the Premier League, ESPN, any club or any show or network. Their names, logos and marks belong to them and are used here only to say which game or show a pool is about.',
  ] },
  { title: 'Using the service', body: [
    'Use Super Pools as it\'s meant to be used. Don\'t try to break it, get into what isn\'t yours, overload it, or copy it wholesale by machine; the fans\' open data and the code on GitHub (MIT License) are there for anyone to use on their own terms.',
    'Super Pools is free today. If we add paid plans, we will say so before anything you use now costs money, and nothing is charged without your say-so.',
    'We work to keep Super Pools running and your pools safe, but it is provided as it is, without promises that it will always be available or free of mistakes. As far as the law allows, we aren\'t liable for losses that come from using it, from an outage, or from a wrong score or a wrong call.',
  ] },
  { title: 'Changes and leaving', body: [
    'We may change these terms as the product changes; the date below says when, and anything that matters to you we will also tell you in the app. You can stop using Super Pools at any time, and write to hello@superpoolsai.com to delete your account and what we keep about you (the privacy note says how).',
  ] },
];

export default function Terms() {
  return (
    <div className="min-h-dvh px-4 pb-16 pt-10" style={{ background: 'radial-gradient(120% 70% at 50% 0%, rgb(var(--gold-rgb)/.16), transparent 60%), #0b1222' }}>
      <div className="mx-auto max-w-xl">
        <div className="text-center">
          <a href="#/" className="mx-auto mb-3 inline-block drop-shadow-[0_10px_30px_rgb(var(--gold-rgb)/.35)]"><ProductMark size={56} /></a>
          <div className="text-[11px] font-bold uppercase tracking-[.22em] text-gold">{PRODUCT.name}</div>
          <h1 className="mt-1 font-display text-[36px] font-extrabold italic leading-[.95] text-white">The rules, plainly.</h1>
          <p className="mt-3 text-sm text-mute">Super Pools is for groups of friends and a scoreboard. Here is what we ask of everyone who plays, and what you can count on from us.</p>
        </div>
        <div className="mt-8 space-y-4">
          {SECTIONS.map((s) => (
            <section key={s.title} className="card p-4">
              <h2 className="font-display text-lg font-extrabold text-white">{s.title}</h2>
              {s.body.map((b, i) => <p key={i} className="mt-2 text-sm leading-relaxed text-slate-200">{b}</p>)}
            </section>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-mute">Last changed 28 October 2026. Questions: <a className="text-sky-300" href="mailto:hello@superpoolsai.com">hello@superpoolsai.com</a> · <a className="text-sky-300" href="#/privacy">Privacy</a> · © 2026 {PRODUCT.name} · <a className="text-sky-300" href="#/">Back to the app</a></p>
      </div>
    </div>
  );
}
