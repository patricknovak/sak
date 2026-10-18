// Super Pools landing pages: the reveal on scroll, the live board with its goal horn, the game-night demos (the swings,
// the draft clock) and the try-it question (all fictional, drawn in the page), the events open right now (real, from the
// app), the premiere countdown, the waitlist, consented GA4 and first-touch UTM. Every piece checks its element exists,
// so each page uses what it has.
document.documentElement.classList.add('js');
var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

// GA4 measurement ID (public). Empty means nothing loads; consent still gates the tag.
var GA4_ID = 'G-1QP4G3BP5N';
var CONSENT_KEY = 'sp_analytics_consent';
var TOUCH_KEY = 'sp_first_touch';

function spStoreGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function spStoreSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

// First-touch UTM + referrer, captured once on the first landing visit.
(function captureTouch() {
  if (spStoreGet(TOUCH_KEY)) return;
  var q = new URLSearchParams(location.search);
  var get = function (k) { var v = (q.get(k) || '').trim(); return v ? v.slice(0, 200) : null; };
  spStoreSet(TOUCH_KEY, JSON.stringify({
    utm_source: get('utm_source'), utm_medium: get('utm_medium'), utm_campaign: get('utm_campaign'),
    utm_content: get('utm_content'), utm_term: get('utm_term'),
    referrer: document.referrer ? document.referrer.slice(0, 500) : null
  }));
})();

function spAttribution() {
  try {
    var t = JSON.parse(spStoreGet(TOUCH_KEY) || '{}');
    var out = {};
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'referrer'].forEach(function (k) {
      if (t[k]) out[k] = String(t[k]).slice(0, k === 'referrer' ? 500 : 160);
    });
    return out;
  } catch (e) { return {}; }
}

// Consented GA4 + Google Ads (Consent Mode v2). Defaults denied; gtag loads only after Accept.
// Accept maps to analytics_storage + ad_user_data + ad_storage (same as the app); AW tag only then.
var ADS_ID = 'AW-949617778';
(function analytics() {
  if (!GA4_ID) return;
  window.dataLayer = window.dataLayer || [];
  function gtag() { dataLayer.push(arguments); }
  window.gtag = gtag;
  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied',
    analytics_storage: 'denied', wait_for_update: 500
  });
  gtag('js', new Date());
  gtag('config', GA4_ID, { send_page_view: true, anonymize_ip: true });

  function loadTag() {
    if (document.getElementById('sp-ga4')) return;
    var s = document.createElement('script');
    s.id = 'sp-ga4'; s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID);
    document.head.appendChild(s);
  }
  function grantAds() {
    gtag('consent', 'update', {
      analytics_storage: 'granted', ad_user_data: 'granted', ad_storage: 'granted'
    });
  }
  function configAds() {
    gtag('config', ADS_ID, { allow_enhanced_conversions: true });
  }
  function setConsent(granted) {
    spStoreSet(CONSENT_KEY, granted ? 'granted' : 'denied');
    if (granted) {
      grantAds();
      loadTag();
      configAds();
    } else {
      gtag('consent', 'update', {
        analytics_storage: 'denied', ad_user_data: 'denied', ad_storage: 'denied',
        ad_personalization: 'denied'
      });
    }
    var bar = document.getElementById('sp-consent');
    if (bar) bar.remove();
  }
  if (spStoreGet(CONSENT_KEY) === 'granted') { grantAds(); loadTag(); configAds(); return; }
  if (spStoreGet(CONSENT_KEY) === 'denied') return;

  function showBanner() {
    if (document.getElementById('sp-consent')) return;
    var bar = document.createElement('div');
    bar.id = 'sp-consent';
    bar.setAttribute('role', 'dialog');
    bar.setAttribute('aria-label', 'Analytics cookies');
    bar.innerHTML = '<div class="sp-consent-inner"><p>Allow analytics? We count how Super Pools gets used and whether a sign-up came from one of our ads. No ads are shown in Super Pools.</p>'
      + '<div class="sp-consent-actions"><button type="button" class="btn btn-ghost btn-sm" data-c="0">No thanks</button>'
      + '<button type="button" class="btn btn-gold btn-sm" data-c="1">Accept</button></div></div>';
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('[data-c]'); if (!b) return;
      setConsent(b.getAttribute('data-c') === '1');
    });
    document.body.appendChild(bar);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
  else showBanner();
})();

// reveal on scroll
(function () {
  var els = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window) || still) { els.forEach(function (e) { e.classList.add('in'); }); return; }
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
  els.forEach(function (e) { io.observe(e); });
})();

// a button that says what it is for picks it in the form
document.querySelectorAll('[data-pick]').forEach(function (a) {
  a.addEventListener('click', function () { var s = document.querySelector('#wl select'); if (s) s.value = a.getAttribute('data-pick'); });
});

// the live board: a fictional pool on a game night, points landing as the box scores change
(function () {
  var board = document.getElementById('board'); if (!board) return;
  var rows = Array.prototype.slice.call(board.querySelectorAll('.row')), ev = document.getElementById('board-ev');
  // [team, points, what happened, a goal sounds the horn]
  var plays = [
    ['Top Shelf', 3.0, 'McDavid scores on the power play', 'McDavid, on the power play'], ['Hat Trick Club', 2.0, 'Makar assist, his second tonight'],
    ['Zamboni Drivers', 4.6, 'Shesterkin stops 38 for the win'], ['Five Hole Heroes', 1.5, 'Pastrnak: 6 shots, a goal disallowed'],
    ['Hat Trick Club', 3.0, 'MacKinnon goal, 1:12 into the third', 'MacKinnon, 1:12 into the third'], ['Top Shelf', 1.0, 'Hughes power-play assist'],
    ['Five Hole Heroes', 3.5, 'Kaprizov from the slot', 'Kaprizov, from the slot'], ['Zamboni Drivers', 2.0, 'Kucherov to Point, again']
  ];
  var colors = { 'Hat Trick Club': '#f7c548', 'Top Shelf': '#38bdf8', 'Zamboni Drivers': '#c4b5fd', 'Five Hole Heroes': '#34d399' };
  var horn = document.getElementById('horn'), hornTimer;
  function sound(p) {
    if (!horn) return;
    var ring = horn.querySelector('.ring');
    ring.style.background = colors[p[0]]; ring.textContent = p[0].charAt(0);
    document.getElementById('horn-t').textContent = p[3]; document.getElementById('horn-p').textContent = '+' + p[1].toFixed(1);
    horn.querySelector('small').textContent = 'Goal · ' + p[0];
    horn.classList.add('on'); clearTimeout(hornTimer); hornTimer = setTimeout(function () { horn.classList.remove('on'); }, 2300);
  }
  // the room reacts: a few faces rise off the row that just moved
  function react(r, big) {
    var faces = big ? ['🔥', '😱', '🔥', '👏'] : ['👏', '🔥'];
    faces.forEach(function (f, k) {
      setTimeout(function () {
        var e = document.createElement('span'); e.className = 'rise'; e.textContent = f;
        e.style.left = (r.offsetLeft + r.offsetWidth - 70 + k * 14) + 'px'; e.style.top = (r.offsetTop + r.offsetHeight / 2 - 12 + parseFloat((r.style.transform.match(/-?[\d.]+/) || [0])[0])) + 'px';
        board.appendChild(e); setTimeout(function () { e.remove(); }, 2000);
      }, k * 160);
    });
  }
  var i = 0, h = rows[0].offsetHeight + 7;
  function place() {
    var sorted = rows.slice().sort(function (a, b) { return parseFloat(b.dataset.p) - parseFloat(a.dataset.p); });
    rows.forEach(function (r) { var to = sorted.indexOf(r), from = Number(r.dataset.i); r.style.transform = 'translateY(' + (to - from) * h + 'px)'; r.querySelector('.rk').textContent = to + 1; });
  }
  rows.forEach(function (r, k) { r.dataset.i = k; });
  if (still) return;
  setInterval(function () {
    var p = plays[i++ % plays.length], r = rows.filter(function (x) { return x.dataset.t === p[0]; })[0];
    var v = Math.round((parseFloat(r.dataset.p) + p[1]) * 10) / 10; r.dataset.p = v;
    r.querySelector('.v').textContent = v.toFixed(1); r.querySelector('.bump').textContent = '+' + p[1].toFixed(1);
    r.classList.add('flash'); setTimeout(function () { r.classList.remove('flash'); }, 1600);
    if (ev) ev.innerHTML = '<b>' + p[0] + '</b> +' + p[1].toFixed(1) + ' · ' + p[2];
    place();
    if (p[3]) sound(p);
    setTimeout(function () { react(r, !!p[3]); }, 520);
  }, 2600);
})();

// try it: one question priced the way a pool prices it (the market maker in docs/POOLS.md), in pretend coins
(function () {
  var m = document.getElementById('market'); if (!m) return;
  var b = 160, q = { y: -70, n: 0 }, hist = [], left = 300;
  var price = function () { var ey = Math.exp(q.y / b), en = Math.exp(q.n / b); return ey / (ey + en); };
  var cost = function (y, n) { var mx = Math.max(y, n); return mx + b * Math.log(Math.exp((y - mx) / b) + Math.exp((n - mx) / b)); };
  // a believable week of trading before you arrive
  var seed = [18, -10, 26, 14, -30, -22, 12, 34, -16, 20, 28, -12, 16, -8, 22];
  seed.forEach(function (d) { if (d > 0) q.y += d; else q.n -= d; hist.push(price()); });
  var line = m.querySelector('.ln'), area = m.querySelector('.ar'), dot = m.querySelector('.dt'), rc = m.querySelector('.receipt');
  function draw() {
    // the chart fits its own range, so a week of small moves still reads as a market
    var lo = Math.min.apply(null, hist) - .04, hi = Math.max.apply(null, hist) + .04;
    var n = hist.length, pts = hist.map(function (p, k) { return [k / (n - 1) * 300, 110 - (p - lo) / (hi - lo) * 100]; });
    var mid = m.querySelector('.mid'); if (mid) { var y = 110 - (.5 - lo) / (hi - lo) * 100; mid.setAttribute('y1', y); mid.setAttribute('y2', y); mid.style.display = y > 4 && y < 114 ? '' : 'none'; }
    var d = pts.map(function (p, k) { return (k ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    line.setAttribute('d', d); area.setAttribute('d', d + ' L300 118 L0 118 Z');
    var last = pts[n - 1]; dot.setAttribute('cx', last[0]); dot.setAttribute('cy', last[1]);
    var p = price();
    m.querySelector('[data-k=y]').style.setProperty('--w', Math.round(p * 100) + '%'); m.querySelector('[data-k=n]').style.setProperty('--w', Math.round((1 - p) * 100) + '%');
    m.querySelector('[data-k=y] b').textContent = Math.round(p * 100) + '%'; m.querySelector('[data-k=n] b').textContent = Math.round((1 - p) * 100) + '%';
  }
  draw();
  m.querySelectorAll('.opt').forEach(function (o) {
    o.addEventListener('click', function () {
      var k = o.dataset.k, stake = 100;
      if (left < stake) { rc.innerHTML = 'That was your <b>300</b>. In a real pool, more coins drop every week.'; return; }
      var before = price(), c0 = cost(q.y, q.n), lo = 0, hi = 2000;
      // the shares 100 coins buy: the cost of the market after the trade, less before, is the stake
      for (var t = 0; t < 60; t++) { var mid = (lo + hi) / 2, c = k === 'y' ? cost(q.y + mid, q.n) : cost(q.y, q.n + mid); if (c - c0 > stake) hi = mid; else lo = mid; }
      q[k] += lo; left -= stake; hist.push(price()); draw();
      var p = k === 'y' ? price() : 1 - price(), was = k === 'y' ? before : 1 - before;
      rc.innerHTML = '100 coins bought <b>' + Math.round(lo) + ' shares</b> of ' + (k === 'y' ? 'East' : 'West') + '. If it hits, you collect <b>' + Math.round(lo) + '</b>. You moved the price from ' + Math.round(was * 100) + '% to ' + Math.round(p * 100) + '%. ' + left + ' coins left.';
    });
  });
})();

// game night is a room: the night's swings, landing one after another (a fictional pool)
(function () {
  var feed = document.getElementById('feed'); if (!feed) return;
  var swings = [
    ['H', '#f7c548', 'Goal', 'MacKinnon', 'Hat Trick Club · vs DAL', 3.0, ['🔥 4', '😱 1']],
    ['T', '#38bdf8', 'Assist', 'Quinn Hughes', 'Top Shelf · @ VAN', 2.0, ['👏 2']],
    ['Z', '#c4b5fd', 'Win', 'Shesterkin', 'Zamboni Drivers · 38 saves', 4.6, ['🧊 3']],
    ['F', '#34d399', '2 SOG · 1 HIT', 'Kaprizov', 'Five Hole Heroes · vs CHI', 1.0, []],
    ['T', '#38bdf8', 'Goal', 'McDavid', 'Top Shelf · power play', 3.5, ['🔥 6', '😂 2']],
    ['F', '#34d399', '−1 +/−', 'Brady Tkachuk', 'Five Hole Heroes · @ OTT', -0.5, ['😂 3']]
  ];
  var i = 0;
  function add() {
    var w = swings[i++ % swings.length], hot = w[2] === 'Goal' || w[2] === 'Win';
    var el = document.createElement('div'); el.className = 'sw' + (hot ? ' hot' : '');
    el.innerHTML = '<span class="tb" style="background:' + w[1] + '">' + w[0] + '</span><span class="w"><small>' + w[2] + '</small><b>' + w[3] + '</b> <i>' + w[4] + '</i></span>'
      + '<span class="d' + (w[5] < 0 ? ' neg' : '') + '">' + (w[5] < 0 ? '' : '+') + w[5].toFixed(1) + '</span>'
      + (w[6].length ? '<span class="rx">' + w[6].map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</span>' : '');
    feed.insertBefore(el, feed.children[1] || null);
    while (feed.children.length > 5) feed.removeChild(feed.lastChild);
  }
  for (var k = 0; k < 4; k++) add();
  if (!still) setInterval(add, 2600);
})();

// the draft clock: six seconds, then the pick is made on the second (a fictional draft)
(function () {
  var box = document.getElementById('clock'); if (!box) return;
  var arc = document.getElementById('arc'), secs = document.getElementById('secs'), pin = document.getElementById('pickin'), pk = document.getElementById('pickp');
  var picks = [['Top Shelf', 'Quinn Hughes, D', 11], ['Zamboni Drivers', 'Jack Eichel, C', 12], ['Hat Trick Club', 'Igor Shesterkin, G', 13], ['Five Hole Heroes', 'Kirill Kaprizov, LW', 14]];
  var n = 0, t = 6, LEN = 452;
  function show() {
    secs.textContent = '0:0' + t; arc.style.strokeDashoffset = String(LEN * (1 - t / 6)); arc.classList.toggle('late', t <= 2);
  }
  function round() {
    var p = picks[n++ % picks.length];
    box.querySelector('.who2').innerHTML = '<span>Round 2 · Pick ' + p[2] + '</span><span>' + p[0] + '</span>';
    pk.textContent = p[1]; pin.querySelector('small').textContent = p[0] + ' · pick ' + p[2] + ' · made by the clock';
    pin.classList.remove('on'); t = 6; show();
    var iv = setInterval(function () {
      t--; show();
      if (t === 0) { clearInterval(iv); pin.classList.add('on'); setTimeout(round, 2800); }
    }, 1000);
  }
  if (still) { t = 0; show(); pin.classList.add('on'); return; }
  round();
})();

// open right now: the events open on Super Pools this minute, read from the app's own list with the publishable key,
// each with a countdown to its next lock. If the list can't be read, the board shows the seasons that are always on.
(function () {
  var box = document.getElementById('now'); if (!box) return;
  var tag = document.getElementById('now-tag');
  var APP = 'https://app.superpoolsai.com/#/new';
  var KEY = 'sb_publishable_AMcluryqKenfAO6vFJ2f1A_50DhQz1b';
  var KIND = { pickem: "Pick'em", survivor: 'Last one standing', score: 'Call the score', streak: 'Daily streak', props: 'Prop sheet', players: 'Box pool',
    series: 'Series calls', rank: 'Rank the teams', bracket: 'Bracket', sweep: 'Sweepstake', squares: 'Squares' };
  var LOOK = { nhl: ['NHL', '#f7c548'], nfl: ['NFL', '#38bdf8'], mlb: ['MLB', '#34d399'], nba: ['NBA', '#fb923c'], epl: ['EPL', '#c4b5fd'], mls: ['MLS', '#2dd4bf'], ncaa: ['NCAA', '#fb7185'], soccer: ['FC', '#c4b5fd'] };
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  function look(e) { return LOOK[e.competition] || LOOK[(e.competition || '').split('-')[0]] || LOOK[e.sport] || ['GO', '#94a3b8']; }
  function left(ms) {
    if (ms <= 0) return null;
    var d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4), s = Math.floor(ms % 6e4 / 1e3);
    return d ? d + 'd ' + h + 'h' : h ? h + 'h ' + String(m).padStart(2, '0') + 'm' : m + ':' + String(s).padStart(2, '0');
  }
  function matches(e) {
    var now = Date.now(), out = [];
    (e.grids || []).forEach(function (g) { if (!g.tbd && g.high && g.low) out.push(g.low + ' v ' + g.high + ' · ' + (g.short || g.label)); });
    if (!out.length) (e.sheets || []).filter(function (x) { return Date.parse(x.kickoff) > now; }).slice(0, 3).forEach(function (x) { out.push(x.away + ' @ ' + x.home); });
    return out.slice(0, 3);
  }
  function card(e) {
    var lk = look(e), link = e.pack ? APP + '?pack=' + encodeURIComponent(e.pack) : APP + '?comp=' + encodeURIComponent(e.competition);
    var kinds = (e.kinds || []).map(function (k) { return KIND[k] || k; });
    var m = matches(e);
    return '<a class="ev rv in" href="' + link + '" style="--c:' + lk[1] + '">'
      + '<div class="top"><span class="badge">' + lk[0] + '</span><div><h3>' + esc(e.open_round && e.open_round === e.final_round && (e.grids || []).length ? 'The ' + String(e.final_label).replace(/^The /, '') : e.name) + '</h3><div class="stage">' + esc(e.stage || e.open_label || '') + '</div></div></div>'
      + (e.next_lock ? '<div class="lock" data-at="' + Date.parse(e.next_lock) + '"><span>Next lock in</span><b>…</b></div>' : '<div class="lock"><b>Open</b></div>')
      + (m.length ? '<div class="match">' + m.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '')
      + (kinds.length ? '<div class="kinds">' + kinds.map(function (k) { return '<span>' + esc(k) + '</span>'; }).join('') + (e.pack ? '<span>Questions</span>' : '') + '</div>' : '')
      + '<span class="go">Start a pool on it</span></a>';
  }
  function tick() {
    box.querySelectorAll('.lock[data-at]').forEach(function (l) {
      var t = left(Number(l.getAttribute('data-at')) - Date.now());
      if (t) l.querySelector('b').textContent = t;
      else { l.classList.add('live'); l.innerHTML = '<span>Under way</span><b>Live</b>'; l.removeAttribute('data-at'); }
    });
  }
  var always = [
    { name: 'NHL 2026-27', competition: 'nhl-2026', stage: 'The regular season', kinds: ['players'] },
    { name: 'NFL', competition: 'nfl', stage: 'Every week of the season', kinds: ['pickem', 'survivor', 'props', 'streak'] },
    { name: 'Premier League', competition: 'epl', stage: 'Every matchweek', kinds: ['pickem', 'survivor', 'score', 'streak'] }
  ];
  function draw(list, real) {
    // an event reaching its final within two weeks first (the World Series in its week), then the soonest lock
    var soon = function (e) { return e.final_starts && Date.parse(e.final_starts) - Date.now() < 14 * 864e5 ? 0 : 1; };
    list.sort(function (a, b) { return soon(a) - soon(b) || (Date.parse(a.next_lock) || 9e15) - (Date.parse(b.next_lock) || 9e15); });
    box.innerHTML = list.map(card).join('') + '<a class="ev rv in" href="' + APP + '?type=questions" style="--c:#f7c548"><div class="top"><span class="badge">ASK</span><div><h3>Anything else</h3><div class="evstage">The game you\'re watching, the office, the family</div></div></div>'
      + '<div class="lock"><b>Your call</b></div><div class="kinds"><span>Questions with odds</span><span>Your own rules</span></div><span class="go">Ask your own questions</span></a>';
    if (tag) tag.textContent = real ? list.length + ' events open now' : 'Open all season';
    tick();
  }
  fetch('https://quakdkzdafzlhgjvmypg.supabase.co/rest/v1/rpc/pool_event_list', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) { if (!Array.isArray(d) || !d.length) throw new Error('empty'); draw(d, true); })
    .catch(function () { draw(always, false); });
  setInterval(tick, 1000);
})();

// Love Is Blind Season 11 by the calendar (Netflix drops at 3 am ET): the countdown counts to whatever is next, and once
// the pods are open the copy written for before the premiere says what's next instead. An element with data-next holds
// a template ({next} is "drop 2 lands", {date} "October 21"); it keeps its own words until the premiere has aired.
var LIB_STAGES = [
  { at: Date.UTC(2026, 9, 14, 7), next: 'the pods open', date: 'October 14' },
  { at: Date.UTC(2026, 9, 21, 7), next: 'drop 2 lands', date: 'October 21' },
  { at: Date.UTC(2026, 9, 28, 7), next: 'drop 3 lands', date: 'October 28' },
  { at: Date.UTC(2026, 10, 4, 8), next: 'the weddings land', date: 'November 4' },
  { at: Date.UTC(2026, 10, 11, 8), next: 'the reunion drops', date: 'November 11' },
];
function libStage() { for (var i = 0; i < LIB_STAGES.length; i++) if (LIB_STAGES[i].at > Date.now()) return i; return -1; }
(function () {
  var i = libStage();
  if (i > 0) document.querySelectorAll('[data-next]').forEach(function (el) {
    el.textContent = el.getAttribute('data-next').replace('{next}', LIB_STAGES[i].next).replace('{date}', LIB_STAGES[i].date);
  });
  if (i < 0) document.querySelectorAll('[data-done]').forEach(function (el) { el.textContent = el.getAttribute('data-done'); });
})();
(function () {
  var box = document.getElementById('premiere'); if (!box) return;
  function tick() {
    var i = libStage();
    if (i < 0) { box.innerHTML = '<div style="min-width:auto;padding:10px 14px"><b style="font-size:24px">Season 11 is in the books</b></div>'; return; }
    var ms = Math.max(0, LIB_STAGES[i].at - Date.now()), d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
    box.querySelector('[data-u=d]').textContent = d; box.querySelector('[data-u=h]').textContent = String(h).padStart(2, '0'); box.querySelector('[data-u=m]').textContent = String(m).padStart(2, '0');
  }
  tick(); setInterval(tick, 30000);
})();

// The waitlist writes straight to the database through its public API; the key below is the publishable one and can
// only insert into the waitlist table (see supabase/migrations/20261005000061_waitlist.sql).
(function () {
  var form = document.getElementById('wl'); if (!form) return;
  var API = 'https://quakdkzdafzlhgjvmypg.supabase.co/rest/v1/waitlist';
  var KEY = 'sb_publishable_AMcluryqKenfAO6vFJ2f1A_50DhQz1b';
  var msg = document.getElementById('wl-msg');
  var fallback = 'Something went wrong. Email <a href="mailto:hello@superpoolsai.com">hello@superpoolsai.com</a> and we will add you by hand.';
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = form.email.value.trim(), note = form.note.value.trim(), pick = form.pick.value;
    if (form.website.value) return;  // a bot filled the hidden field
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { msg.className = 'msgline err wide'; msg.textContent = 'That address does not look right.'; return; }
    var btn = form.querySelector('button'); btn.disabled = true; msg.className = 'msgline wide'; msg.textContent = 'One moment.';
    var base = { email: email, league: pick, note: note || null, source: (location.hostname + location.pathname).slice(0, 120) };
    var withAttr = Object.assign({}, base, spAttribution());
    function post(body) {
      return fetch(API, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(body)
      });
    }
    // send UTM columns when live; if PostgREST rejects unknown columns, retry without (safe before the migration)
    post(withAttr).then(function (r) {
      if (r.status === 201 || r.status === 409) return r;
      if (r.status === 400 || r.status === 403) return post(base);
      return r;
    }).then(function (r) {
      if (r.status === 201) { msg.className = 'msgline ok wide'; msg.textContent = pick === 'Love Is Blind pool' ? 'You are on the list. Your invite comes before the pods open.' : 'You are on the list. We will write when your pool can open.'; form.reset(); }
      else if (r.status === 409) { msg.className = 'msgline ok wide'; msg.textContent = 'You were already on the list. We have not forgotten.'; }
      else { msg.className = 'msgline err wide'; msg.innerHTML = fallback; }
    }).catch(function () { msg.className = 'msgline err wide'; msg.innerHTML = fallback; })
      .finally(function () { btn.disabled = false; });
  });
})();

// copy that follows the calendar: an element with data-until is gone from that moment, one with data-from appears then
// (an event's page says "opening night October 20" until then and "every night" after, without a redeploy)
(function () {
  var now = Date.now();
  document.querySelectorAll('[data-until]').forEach(function (el) { if (now >= Date.parse(el.getAttribute('data-until'))) el.remove(); });
  // site.css keeps data-from hidden, so without the script a page reads as it did before its date
  document.querySelectorAll('[data-from]').forEach(function (el) { if (now < Date.parse(el.getAttribute('data-from'))) el.remove(); else el.removeAttribute('data-from'); });
})();
