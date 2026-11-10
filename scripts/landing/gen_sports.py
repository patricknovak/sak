#!/usr/bin/env python3
"""Writes landing/{hockey,football,basketball,soccer}-pools.html from one template, so the head, header, footer and the
FAQPage JSON-LD (built from the visible FAQ) stay the same on all four."""
import html, json, re, sys
from pathlib import Path

OUT = Path('/home/user/sak/landing')
APP = 'https://app.superpoolsai.com/#/new?'

def app(q):
    return html.escape(APP + q, quote=True)

def ico(name):
    return f'<svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-{name}"/></svg>'

def strip_tags(s):
    return re.sub(r'\s+', ' ', html.unescape(re.sub(r'<[^>]+>', '', s))).strip()

HEADER = '''  <header class="site-head">
    <a class="wordmark" href="./" aria-label="Super Pools home">
      <svg viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#111b30"/><circle cx="32" cy="32" r="17" fill="none" stroke="#f7c548" stroke-width="4"/><circle cx="32" cy="32" r="4.5" fill="#f7c548"/><g stroke="#f7c548" stroke-width="2.6" stroke-linecap="round"><line x1="25" y1="8" x2="25" y2="12.5"/><line x1="39" y1="8" x2="39" y2="12.5"/><line x1="25" y1="51.5" x2="25" y2="56"/><line x1="39" y1="51.5" x2="39" y2="56"/></g></svg>
      <span><b>SUPER</b> POOLS</span>
    </a>
    <nav class="navlinks" aria-label="Doors"><a href="./fantasy-hockey.html">Fantasy league</a><a href="./#kinds">Sports pools</a><a href="./together.html">Show pools</a><a href="./fans.html">Fan zones</a><a href="./pricing.html">Pricing</a></nav>
    <div class="head-right">
      <a class="signin" href="https://app.superpoolsai.com/">Sign in</a>
      <button type="button" class="menu-btn" id="menu-btn" aria-expanded="false" aria-controls="menu" aria-label="Open the menu">
        <svg class="bars" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        <svg class="x" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </button>
    </div>
    <nav class="menu" id="menu" aria-label="Menu">
      <a href="./fantasy-hockey.html"><span class="mi"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-trophy"/></svg></span><span><b>Fantasy league</b><small>Keepers, the draft room, a league voice</small></span></a>
      <a href="./#kinds"><span class="mi"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-target"/></svg></span><span><b>Sports pools</b><small>The NFL, NHL, NBA and soccer</small></span></a>
      <a href="./together.html"><span class="mi r"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-tv"/></svg></span><span><b>Show pools</b><small>Call what happens next, with your group</small></span></a>
      <a href="./fans.html"><span class="mi"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-chart"/></svg></span><span><b>Fan zones</b><small>Every club, read like a front office</small></span></a>
      <a href="./pricing.html"><span class="mi n"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-coin"/></svg></span><span><b>Pricing</b><small>Per pool, never per person</small></span></a>
      <a href="https://app.superpoolsai.com/"><span class="mi n"><svg class="ico" aria-hidden="true" focusable="false"><use href="./icons.svg#i-users"/></svg></span><span><b>Sign in</b><small>Back to your pools</small></span></a>
    </nav>
  </header>
'''

def footer(league_note):
    return f'''  <footer class="site-foot">
    <div class="cols">
      <div><h2>Play</h2><ul><li><a href="./fantasy-hockey.html">Fantasy league</a></li><li><a href="./hockey-pools.html">Hockey pools</a></li><li><a href="./football-pools.html">NFL pools</a></li><li><a href="./basketball-pools.html">NBA pools</a></li><li><a href="./soccer-pools.html">Soccer pools</a></li><li><a href="./together.html">Show pools</a></li></ul></div>
      <div><h2>Look around</h2><ul><li><a href="./fans.html">Fan zones</a></li><li><a href="./example-pool.html">An example pool</a></li><li><a href="./pricing.html">Pricing</a></li><li><a href="./changelog.html">Changelog</a></li></ul></div>
      <div><h2>Your pools</h2><ul><li><a href="https://app.superpoolsai.com/">Sign in</a></li><li><a href="mailto:hello@superpoolsai.com">hello@superpoolsai.com</a></li></ul></div>
      <div><h2>The fine print</h2><ul><li><a href="https://app.superpoolsai.com/#/privacy">Privacy</a></li><li><a href="https://app.superpoolsai.com/#/terms">Terms</a></li><li><button type="button" class="linkbtn" data-cookie-settings>Cookie settings</button></li></ul></div>
    </div>
    <div class="base"><span>© 2026 Super Pools · superpoolsai.com · Supercoins, never money</span><span>Planetterrian Ventures · 963 8th Ave W, Vancouver, BC V5Z 1E4, Canada</span><span>Scores from public score feeds. {league_note}</span></div>
  </footer>
'''

def head(p):
    faq = {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [
        {"@type": "Question", "name": strip_tags(q), "acceptedAnswer": {"@type": "Answer", "text": strip_tags(a)}} for q, a in p['faq']]}
    faq_json = json.dumps(faq, ensure_ascii=False, separators=(',', ':'))
    url = f"https://superpoolsai.com/{p['slug']}"
    e = lambda s: html.escape(s, quote=True)
    return f'''<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>{e(p['title'])}</title>
  <meta name="description" content="{e(p['desc'])}" />
  <link rel="canonical" href="{url}" />
  <link rel="icon" href="./icon.svg" type="image/svg+xml" />
  <meta name="theme-color" content="#0b1220" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="Super Pools" />
  <meta property="og:url" content="{url}" />
  <meta property="og:title" content="{e(p['og_title'])}" />
  <meta property="og:description" content="{e(p['og_desc'])}" />
  <meta property="og:image" content="https://superpoolsai.com/og.png" />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:alt" content="Super Pools: Fantasy Pools from the Future. Fun fantasy pools with friends, for all. AI-enhanced. Fun for all." />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="{e(p['og_title'])}" />
  <meta name="twitter:description" content="{e(p['og_desc'])}" />
  <meta name="twitter:image" content="https://superpoolsai.com/og.png" />
  <link rel="preload" href="./fonts/barlow-condensed-900.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="./fonts/barlow-condensed-900-italic.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="preload" href="./fonts/inter.woff2" as="font" type="font/woff2" crossorigin />
  <link rel="stylesheet" href="./site.css" />
  <link rel="stylesheet" href="./site-sports.css" />
  <!-- the questions people ask, for search: the same words as the FAQ on the page (written from it) -->
  <script type="application/ld+json">{faq_json}</script>
</head>
'''

def attrs_of(d):
    return ''.join(' %s="%s"' % (a, v) for a, v in d.items())

def kind_row(k):
    if k.get('href'):
        attrs = attrs_of(k.get('attrs', {}))
        return f'''        <li{attrs}><a class="kl" href="{k['href']}"><span class="ki">{ico(k['icon'])}</span><b>{k['name']}</b><span class="ln">{k['line']}</span><span class="go"><small>{k['tag']}</small>Start</span></a></li>'''
    attrs = attrs_of(k.get('attrs', {}))
    whens = ''.join('<span class="when2"%s>%s</span>' % (attrs_of(w[1]), w[0]) for w in k['when'])
    return f'''        <li{attrs}><div class="kl"><span class="ki">{ico(k['icon'])}</span><b>{k['name']}</b><span class="ln">{k['line']}</span>{whens}</div></li>'''

def page(p):
    s = []
    s.append(head(p))
    # the header and the footer sit outside <main>, so the page has its banner and contentinfo landmarks
    s.append('<body>\n  <a class="skip" href="#main">Skip to content</a>\n')
    s.append(HEADER)
    s.append('  <main id="main">\n')
    ghosts = '<div class="ev ghost"></div>' * p['ghosts']
    one = ' one' if p['ghosts'] == 1 else ''
    swipe = '\n        <p class="swipe">Swipe for every event</p>' if p['ghosts'] > 1 else ''
    s.append(f'''
    <!-- 1. Hero: the claim, the one gold button, and this sport's events open right now (real, from the app) -->
    <section class="hero2 hero2-split" id="top">
      <div class="hero2-copy">
        <h1 class="display">{p['h1']}</h1>
        <p class="sub">{p['sub']} <b>Never money.</b></p>
        <div class="cta2">
          <a class="btn btn-gold btn-lg" data-gold href="{app(p['cta'])}">{p['cta_label']}</a>
          <a class="textlink" href="#demo">{p['demo_link']}</a>
        </div>
        <p class="proofline" id="proof"><span class="pi" aria-hidden="true">{ico(p['proof_icon'])}</span>{p['proofline']}</p>
      </div>
      <div class="nowpanel" id="open">
        <div class="nowhead">
          <h2 class="display">The next deadline</h2>
          <span class="livetag" id="now-tag" aria-live="polite">{p['now_tag']}</span>
          <p>{p['now_p']}</p>
        </div>
        <div class="rail{one}" id="now" data-src="{p['src']}" data-sport="{p['sport']}">
          {ghosts}
        </div>{swipe}
      </div>
    </section>
''')
    # 2. kinds
    rows = '\n'.join(kind_row(k) for k in p['kinds'])
    cal = ''
    if p.get('cal'):
        cal = f'''
      <div class="label klabel">{p['cal_label']}</div>
      <ul class="kindlist">
{chr(10).join(kind_row(k) for k in p['cal'])}
      </ul>'''
    more = p.get('more', '')
    s.append(f'''
    <!-- 2. The pools open on this sport today, each link keeping its kind; the ones still to come say when -->
    <section id="kinds">
      <div class="shead rv">
        <div class="eyebrow">The pools</div>
        <h2 class="display">{p['kinds_h2']}</h2>
        <p class="lead">{p['kinds_lead']}</p>
      </div>
      <ul class="kindlist">
{rows}
      </ul>{cal}{more}
    </section>
''')
    # 3. steps
    steps = '\n'.join(f'        <div class="card rv"><div class="num">0{i+1}</div><h3>{t}</h3><p>{b}</p></div>' for i, (t, b) in enumerate(p['steps']))
    s.append(f'''
    <!-- 3. Three steps from the group chat to a table -->
    <section id="how">
      <div class="shead rv">
        <div class="eyebrow">How it works</div>
        <h2 class="display">{p['steps_h2']}</h2>
      </div>
      <div class="steps">
{steps}
      </div>
    </section>
''')
    # 4. demo
    s.append(f'''
    <!-- 4. One sample pool, drawn in HTML (fictional, captioned so) -->
    <section id="demo">
      <div class="pillar3">
        <div class="rv">
          <div class="eyebrow">Sample pool</div>
          <h2 class="display">{p['demo_h2']}</h2>
          <p class="lead">{p['demo_lead']}</p>{p.get('demo_fine', '')}
        </div>
{p['demo']}
      </div>
    </section>
''')
    # 5. proof
    plist = '\n'.join(f'          <li><span class="pi" aria-hidden="true">{ico(i)}</span><span>{t}</span></li>' for i, t in p['proof'])
    s.append(f'''
    <!-- 5. Proof: the founding league, and what these pools do every game (docs/BRAND.md section 3; research gap-3 section 5) -->
    <section id="league">
      <div class="shead rv">
        <div class="eyebrow">Why it holds up</div>
        <h2 class="display">{p['proof_h2']}</h2>
      </div>
      <div class="proof2 rv">
        <div>
          <div class="crest-head"><img src="./img/sak-icon.svg" alt="The SaK Superleague crest" width="64" height="64" loading="lazy" data-gold /><div><b>SaK Superleague</b><small>Keeper league · est. 2013 · eight teams</small></div></div>
          <p class="founded">The founding league has run on Super Pools every night of the 2026-27 season, from the keeper deadline on.</p>
        </div>
        <ul class="prooflist">
{plist}
        </ul>
      </div>
    </section>
''')
    # 6. faq
    faq = '\n'.join(f'      <details><summary>{q}</summary><p>{a}</p></details>' for q, a in p['faq'])
    s.append(f'''
    <!-- 6. Before you ask (the FAQPage JSON-LD above is written from these words) -->
    <section class="faq" id="faq">
      <div class="shead">
        <div class="eyebrow">Questions</div>
        <h2 class="display">Before you ask.</h2>
      </div>
{faq}
    </section>
''')
    # 7. closer
    s.append(f'''
    <!-- 7. The gold button once more, and one quiet way in for the other reader -->
    <section id="start">
      <div class="closer rv">
        <h2 class="display">{p['close_h2']}</h2>
        <p>{p['close_p']}</p>
        <div class="cta2">
          <a class="btn btn-gold btn-lg" data-gold href="{app(p['cta'])}">{p['cta_label']}</a>
          <a class="textlink" href="{p['close_link'][1]}">{p['close_link'][0]}</a>
        </div>
      </div>
    </section>

''')
    s.append('  </main>\n\n')
    s.append(footer(p['league_note']))
    s.append(f'''
  <div class="stickybar" id="sticky"><a class="btn btn-gold" href="{app(p['cta'])}">{p['cta_label']}</a></div>
  <script src="./site.js"></script>
</body>
</html>
''')
    return ''.join(s)


sys.path.insert(0, str(Path(__file__).parent))
from sports_content import PAGES  # noqa: E402

for p in PAGES:
    (OUT / f"{p['slug']}.html").write_text(page(p))
    print('wrote', p['slug'])
