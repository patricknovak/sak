// Super Pools landing pages, one script for every page: consented GA4 and Google Ads, first-touch UTM and the app-link
// decoration, the phone menu, the sticky bottom button, retired anchors, the reveal on scroll, the events open right
// now (real, from the app), the try-it question and the game-night demos (fictional, drawn in the page), the change
// log's latest lines, the Love Is Blind calendar, copy that follows the calendar, and the fantasy waitlist. Every piece checks
// its element exists, so each page uses what it has.
document.documentElement.classList.add('js');
var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
// GA4 measurement ID (public). Empty means nothing loads; consent still gates the tag.
var GA4_ID = 'G-1QP4G3BP5N';
var CONSENT_KEY = 'sp_analytics_consent';
var ADS_CONSENT_KEY = 'sp_ads_consent';
// Shared with the app (Domain=.superpoolsai.com). Value: a=granted|denied;d=granted|denied.
var CONSENT_COOKIE = 'sp_consent';
var CONSENT_COOKIE_MAX_AGE = 31536000;
var TOUCH_KEY = 'sp_first_touch';

function spRawGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function spRawSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } }

function spConsentCookieHostOk() {
  var h = (location.hostname || '').toLowerCase();
  return h === 'superpoolsai.com' || h.slice(-'.superpoolsai.com'.length) === '.superpoolsai.com';
}

function spParseConsentCookie() {
  try {
    var raw = document.cookie || '';
    var parts = raw.split(';');
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var eq = p.indexOf('=');
      if (eq < 0) continue;
      if (p.slice(0, eq).replace(/^\s+|\s+$/g, '') !== CONSENT_COOKIE) continue;
      var val = p.slice(eq + 1).replace(/^\s+|\s+$/g, '');
      try { val = decodeURIComponent(val); } catch (e) { /* keep */ }
      var out = {};
      var bits = val.split(';');
      for (var j = 0; j < bits.length; j++) {
        var b = bits[j];
        var be = b.indexOf('=');
        if (be < 0) continue;
        var bk = b.slice(0, be).replace(/^\s+|\s+$/g, '');
        var bv = b.slice(be + 1).replace(/^\s+|\s+$/g, '');
        if ((bk === 'a' || bk === 'd') && (bv === 'granted' || bv === 'denied')) out[bk] = bv;
      }
      return out;
    }
  } catch (e) { /* ignore */ }
  return {};
}

function spSyncConsentCookie() {
  if (!spConsentCookieHostOk()) return;
  var a = spRawGet(CONSENT_KEY);
  var d = spRawGet(ADS_CONSENT_KEY);
  if (a !== 'granted' && a !== 'denied') return;
  if (d !== 'granted' && d !== 'denied') return;
  try {
    var value = encodeURIComponent('a=' + a + ';d=' + d);
    document.cookie = CONSENT_COOKIE + '=' + value
      + '; Path=/; Domain=.superpoolsai.com; Max-Age=' + CONSENT_COOKIE_MAX_AGE
      + '; SameSite=Lax; Secure';
  } catch (e) { /* ignore */ }
}

function spHydrateConsentFromCookie() {
  var parsed = spParseConsentCookie();
  if (parsed.a && spRawGet(CONSENT_KEY) == null) spRawSet(CONSENT_KEY, parsed.a);
  if (parsed.d && spRawGet(ADS_CONSENT_KEY) == null) spRawSet(ADS_CONSENT_KEY, parsed.d);
}

function spStoreGet(k) {
  if (k === CONSENT_KEY || k === ADS_CONSENT_KEY) {
    var v = spRawGet(k);
    if (v == null) {
      spHydrateConsentFromCookie();
      return spRawGet(k);
    }
    return v;
  }
  return spRawGet(k);
}
function spStoreSet(k, v) {
  spRawSet(k, v);
  if (k === CONSENT_KEY || k === ADS_CONSENT_KEY) spSyncConsentCookie();
}

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


// Consented GA4 + Google Ads (Consent Mode v2). Defaults denied; gtag loads only after a choice is granted.
// Analytics = analytics_storage; Ads = ad_storage + ad_user_data + AW tag. Two choices, asked the way the app's
// ConsentBanner asks them: the analytics question is the bar, one answer closes it, and the ads question, folded behind
// "Choices", counts as denied unless the visitor opens it and says yes. Both keys are then set, so the shared cookie is
// written on that one tap and the app does not ask again.
// Remote hits only from production landing hosts (same idea as the app's PR #304 allowlist).
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

  function analyticsAllowed() {
    try { if (window.__spAnalyticsTest) return true; } catch (e) { /* ignore */ }
    if (typeof navigator !== 'undefined' && navigator.webdriver) return false;
    var h = (location.hostname || '').toLowerCase();
    return h === 'superpoolsai.com' || h === 'www.superpoolsai.com';
  }
  function loadTag() {
    if (!analyticsAllowed()) return;
    if (document.getElementById('sp-ga4')) return;
    var s = document.createElement('script');
    s.id = 'sp-ga4'; s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA4_ID);
    document.head.appendChild(s);
  }
  function analyticsOn() { return spStoreGet(CONSENT_KEY) === 'granted'; }
  function adsOn() { return spStoreGet(ADS_CONSENT_KEY) === 'granted'; }
  function applyFlags() {
    gtag('consent', 'update', {
      analytics_storage: analyticsOn() ? 'granted' : 'denied',
      ad_user_data: adsOn() ? 'granted' : 'denied',
      ad_storage: adsOn() ? 'granted' : 'denied',
      ad_personalization: 'denied'
    });
  }
  function configAds() {
    if (!analyticsAllowed() || !adsOn()) return;
    gtag('config', ADS_ID, { allow_enhanced_conversions: true });
  }
  function loadIfNeeded() {
    if (analyticsOn() || adsOn()) loadTag();
    configAds();
  }
  function closeBar() {
    var bar = document.getElementById('sp-consent');
    if (bar) bar.remove();
    document.dispatchEvent(new Event('sp:consent'));
  }
  // The analytics answer closes the bar. An ads question nobody opened is recorded as denied (never granted on the
  // visitor's behalf); an ads answer already given, here or in the app, is kept.
  function setAnalytics(granted) {
    spStoreSet(CONSENT_KEY, granted ? 'granted' : 'denied');
    if (spStoreGet(ADS_CONSENT_KEY) == null) spStoreSet(ADS_CONSENT_KEY, 'denied');
    applyFlags(); loadIfNeeded(); closeBar();
  }
  // The ads answer is saved where it is; the bar closes once the analytics question has an answer too.
  function setAds(granted, row) {
    spStoreSet(ADS_CONSENT_KEY, granted ? 'granted' : 'denied');
    applyFlags(); loadIfNeeded();
    if (row) row.classList.add('done');
    if (spStoreGet(CONSENT_KEY) != null) closeBar();
  }
  function showBanner() {
    if (document.getElementById('sp-consent')) return;
    var bar = document.createElement('div');
    bar.id = 'sp-consent';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Cookie choices');
    bar.innerHTML = '<div class="sp-consent-inner">'
      + '<div class="sp-row"><p>Count your visits to help make Super Pools better? No ads in the app. <a href="https://app.superpoolsai.com/#/privacy">Privacy</a></p>'
      + '<div class="sp-consent-actions"><button type="button" class="linkbtn sp-more" data-choices aria-expanded="false" aria-controls="sp-ads">Choices</button>'
      + '<button type="button" class="btn btn-ghost" data-a="0">No thanks</button>'
      + '<button type="button" class="btn btn-ice" data-a="1">Accept</button></div></div>'
      + '<div class="sp-row sp-ads" id="sp-ads"><p>Help us count sign-ups from our Google ads? A scrambled one-way code from your email, never the email.</p>'
      + '<div class="sp-consent-actions"><button type="button" class="btn btn-ghost" data-d="0">No</button>'
      + '<button type="button" class="btn btn-ghost" data-d="1">Yes</button></div></div></div>';
    bar.addEventListener('click', function (e) {
      var c = e.target.closest('[data-choices]');
      if (c) { var open = bar.classList.toggle('more'); c.setAttribute('aria-expanded', open ? 'true' : 'false'); return; }
      var a = e.target.closest('[data-a]'); if (a) { setAnalytics(a.getAttribute('data-a') === '1'); return; }
      var d = e.target.closest('[data-d]'); if (d) setAds(d.getAttribute('data-d') === '1', d.closest('.sp-ads'));
    });
    document.body.appendChild(bar);
    document.dispatchEvent(new Event('sp:consent'));
  }
  // Footer "Cookie settings" reopens the banner so a visitor can change their mind.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-cookie-settings]');
    if (!a) return;
    e.preventDefault();
    showBanner();
  });
  // Landing→app CTA measurement is app-side (cta_arrival on #/new?src=…); links navigate normally.
  // Empty localStorage keys pick up the shared cookie so the bar is not asked again.
  spHydrateConsentFromCookie();
  applyFlags();
  if (analyticsOn() || adsOn()) loadIfNeeded();
  if (spStoreGet(CONSENT_KEY) != null && spStoreGet(ADS_CONSENT_KEY) != null) return;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
  else showBanner();
})();

// Pass the visitor's own UTM params through to every app.superpoolsai.com link (incoming URL first,
// else the first-touch store), without inventing campaign tags on the landing page itself.
(function decorateAppLinks() {
  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];
  function visitorUtms() {
    var q = new URLSearchParams(location.search);
    var out = new URLSearchParams();
    var any = false;
    KEYS.forEach(function (k) {
      var v = (q.get(k) || '').trim();
      if (v) { out.set(k, v.slice(0, 200)); any = true; }
    });
    if (!any) {
      try {
        var t = JSON.parse(spStoreGet(TOUCH_KEY) || '{}') || {};
        KEYS.forEach(function (k) { if (t[k]) out.set(k, String(t[k]).slice(0, 200)); });
      } catch (e) { /* ignore */ }
    }
    return out;
  }
  function decorate(href) {
    if (!href || href.indexOf('app.superpoolsai.com') < 0) return href;
    try {
      var u = new URL(href, location.href);
      var path = (u.hash || '#').slice(1) || '/';
      if (path.charAt(0) !== '/') path = '/' + path;
      var qi = path.indexOf('?');
      var base = qi >= 0 ? path.slice(0, qi) : path;
      var existing = new URLSearchParams(qi >= 0 ? path.slice(qi + 1) : '');
      visitorUtms().forEach(function (v, k) { if (!existing.has(k)) existing.set(k, v); });
      var qs = existing.toString();
      u.hash = '#' + base + (qs ? '?' + qs : '');
      return u.pathname === '/' && !u.search ? u.origin + '/' + u.hash : u.toString();
    } catch (e) { return href; }
  }
  window.spDecorateAppHref = decorate;
  function apply() {
    document.querySelectorAll('a[href*="app.superpoolsai.com"]').forEach(function (a) {
      a.setAttribute('href', decorate(a.getAttribute('href')));
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply);
  else apply();
})();


// Retired anchors: the home's old sections live on under new ids, so a shared link to #season or #ship still lands
// somewhere true. A fragment never reaches the server, which is why this is here and not in _redirects.
(function () {
  var MOVED = { season: 'kinds', road: 'log', ship: 'log', join: 'start', tiers: 'pricing', runs: 'itself', voice: 'talks',
    sak: 'league', any: 'doors', fans: 'doors', pools: 'kinds' };
  function go() {
    var h = decodeURIComponent(location.hash.slice(1));
    if (!h || !MOVED[h] || document.getElementById(h)) return;
    var to = document.getElementById(MOVED[h]); if (!to) return;
    try { history.replaceState(null, '', '#' + MOVED[h]); } catch (e) { /* file:// */ }
    to.scrollIntoView({ behavior: 'instant' });
    // the open-now board fills in after load and moves what is under it, so land again once it has
    var moved = false, mark = function () { moved = true; };
    ['wheel', 'touchstart', 'keydown'].forEach(function (t) { window.addEventListener(t, mark, { once: true, passive: true }); });
    setTimeout(function () { if (!moved) to.scrollIntoView({ behavior: 'instant' }); }, 900);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go); else go();
  window.addEventListener('hashchange', go);
})();

// The phone menu: doors by audience under 900 px. Escape, a tap outside or a tap on a door closes it.
(function () {
  var btn = document.getElementById('menu-btn'), menu = document.getElementById('menu');
  if (!btn || !menu) return;
  function set(open) {
    menu.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close the menu' : 'Open the menu');
    document.documentElement.classList.toggle('menu-open', open);
    document.dispatchEvent(new Event('sp:menu'));
    if (open) { var f = menu.querySelector('a'); if (f) f.focus({ preventScroll: true }); }
  }
  btn.addEventListener('click', function () { set(!menu.classList.contains('open')); });
  menu.addEventListener('click', function (e) { if (e.target.closest('a')) set(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && menu.classList.contains('open')) { set(false); btn.focus(); } });
  document.addEventListener('click', function (e) { if (menu.classList.contains('open') && !menu.contains(e.target) && !btn.contains(e.target)) set(false); });
})();

// The sticky bottom button (phones): shown once the hero's button has scrolled away, hidden whenever another gold
// element ([data-gold]: the hero's button, a gold word, the closing button) is on screen, so a screen never holds two;
// hidden too while the cookie bar or the menu is open.
(function () {
  var bar = document.getElementById('sticky');
  if (!bar || !('IntersectionObserver' in window)) return;
  var golds = document.querySelectorAll('[data-gold]'), seen = [], ready = false;
  function update() {
    var menuOpen = document.documentElement.classList.contains('menu-open');
    var on = ready && seen.length === 0 && !document.getElementById('sp-consent') && !menuOpen && window.scrollY > 240;
    bar.classList.toggle('on', on);
  }
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      var i = seen.indexOf(e.target);
      if (e.isIntersecting && i < 0) seen.push(e.target);
      if (!e.isIntersecting && i >= 0) seen.splice(i, 1);
    });
    ready = true; update();
  });
  golds.forEach(function (g) { io.observe(g); });
  window.addEventListener('scroll', update, { passive: true });
  document.addEventListener('sp:consent', update);
  document.addEventListener('sp:menu', update);
})();

// reveal on scroll
(function () {
  var els = document.querySelectorAll('.rv');
  if (!('IntersectionObserver' in window) || still) { els.forEach(function (e) { e.classList.add('in'); }); return; }
  var io = new IntersectionObserver(function (es) { es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }); }, { rootMargin: '0px 0px -8% 0px' });
  els.forEach(function (e) { io.observe(e); });
})();

// Start a demo the first time it is on screen, and let its timers skip while the tab is hidden.
function spWhenSeen(el, start) {
  if (!('IntersectionObserver' in window)) { start(); return; }
  var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); start(); } }, { rootMargin: '120px' });
  io.observe(el);
}

// the live board: a fictional pool on a game night, points landing as the box scores change (#board, for any page
// that draws one; the home's hero is the real open-now board instead)
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
  var horn = document.getElementById('horn'), hornTimer;
  function sound(p) {
    if (!horn) return;
    var ring = horn.querySelector('.ring');
    ring.style.background = '#38bdf8'; ring.textContent = p[0].charAt(0);
    document.getElementById('horn-t').textContent = p[3]; document.getElementById('horn-p').textContent = '+' + p[1].toFixed(1);
    horn.querySelector('small').textContent = 'Goal · ' + p[0];
    horn.classList.add('on'); clearTimeout(hornTimer); hornTimer = setTimeout(function () { horn.classList.remove('on'); }, 2300);
  }
  // the room reacts: a few faces rise off the row that just moved
  function react(r, big) {
    var faces = big ? ['🔥', '😱', '🔥', '👏'] : ['👏', '🔥'];
    faces.forEach(function (f, k) {
      setTimeout(function () {
        var e = document.createElement('span'); e.className = 'rise'; e.textContent = f; e.setAttribute('aria-hidden', 'true');
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
  spWhenSeen(board, function () {
    setInterval(function () {
      if (document.hidden) return;
      var p = plays[i++ % plays.length], r = rows.filter(function (x) { return x.dataset.t === p[0]; })[0];
      var v = Math.round((parseFloat(r.dataset.p) + p[1]) * 10) / 10; r.dataset.p = v;
      r.querySelector('.v').textContent = v.toFixed(1); r.querySelector('.bump').textContent = '+' + p[1].toFixed(1);
      r.classList.add('flash'); setTimeout(function () { r.classList.remove('flash'); }, 1600);
      if (ev) ev.innerHTML = '<b>' + p[0] + '</b> +' + p[1].toFixed(1) + ' · ' + p[2];
      place();
      if (p[3]) sound(p);
      setTimeout(function () { react(r, !!p[3]); }, 520);
    }, 2600);
  });
})();

// try it: one question priced the way a pool prices it (the market maker in docs/POOLS.md), in pretend coins
(function () {
  var m = document.getElementById('market'); if (!m) return;
  var b = 160, q = { y: -70, n: 0 }, hist = [], left = 300;
  var price = function () { var ey = Math.exp(q.y / b), en = Math.exp(q.n / b); return ey / (ey + en); };
  var cost = function (y, n) { var mx = Math.max(y, n); return mx + b * Math.log(Math.exp((y - mx) / b) + Math.exp((n - mx) / b)); };
  // a believable week of calls before you arrive
  var seed = [18, -10, 26, 14, -30, -22, 12, 34, -16, 20, 28, -12, 16, -8, 22];
  seed.forEach(function (d) { if (d > 0) q.y += d; else q.n -= d; hist.push(price()); });
  var line = m.querySelector('.ln'), area = m.querySelector('.ar'), dot = m.querySelector('.dt'), rc = m.querySelector('.receipt');
  var names = { y: (m.querySelector('[data-k=y] span') || {}).textContent || 'Yes', n: (m.querySelector('[data-k=n] span') || {}).textContent || 'No' };
  function draw() {
    // the chart fits its own range, so a week of small moves still reads as movement
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
      if (left < stake) { rc.innerHTML = 'That was your <b>300</b>. In a real pool, more Supercoins drop every week.'; return; }
      var before = price(), c0 = cost(q.y, q.n), lo = 0, hi = 2000;
      // what 100 coins buy: the cost of the question after the call, less before, is the 100
      for (var t = 0; t < 60; t++) { var mid = (lo + hi) / 2, c = k === 'y' ? cost(q.y + mid, q.n) : cost(q.y, q.n + mid); if (c - c0 > stake) hi = mid; else lo = mid; }
      q[k] += lo; left -= stake; hist.push(price()); draw();
      var p = k === 'y' ? price() : 1 - price(), was = k === 'y' ? before : 1 - before;
      rc.innerHTML = 'You called <b>' + names[k] + '</b> at ' + Math.round(was * 100) + '% with 100 coins. If it\'s right, it scores <b>' + Math.round(lo) + '</b>. The group\'s chance moved to ' + Math.round(p * 100) + '%. ' + left + ' coins left.';
    });
  });
})();

// game night is a room: the night's swings, landing one after another (a fictional pool)
(function () {
  var feed = document.getElementById('feed'); if (!feed) return;
  var swings = [
    ['H', 'Goal', 'MacKinnon', 'Hat Trick Club · vs DAL', 3.0, ['🔥 4', '😱 1']],
    ['T', 'Assist', 'Quinn Hughes', 'Top Shelf · @ VAN', 2.0, ['👏 2']],
    ['Z', 'Win', 'Shesterkin', 'Zamboni Drivers · 38 saves', 4.6, ['🧊 3']],
    ['F', '2 SOG · 1 HIT', 'Kaprizov', 'Five Hole Heroes · vs CHI', 1.0, []],
    ['T', 'Goal', 'McDavid', 'Top Shelf · power play', 3.5, ['🔥 6', '😂 2']],
    ['F', '-1 +/-', 'Brady Tkachuk', 'Five Hole Heroes · @ OTT', -0.5, ['😂 3']]
  ];
  var i = 0;
  function add() {
    var w = swings[i++ % swings.length], hot = w[1] === 'Goal' || w[1] === 'Win';
    var el = document.createElement('div'); el.className = 'sw' + (hot ? ' hot' : '');
    el.innerHTML = '<span class="tb" aria-hidden="true">' + w[0] + '</span><span class="w"><small>' + w[1] + '</small><b>' + w[2] + '</b> <i>' + w[3] + '</i></span>'
      + '<span class="d' + (w[4] < 0 ? ' neg' : '') + '">' + (w[4] < 0 ? '' : '+') + w[4].toFixed(1) + '</span>'
      + (w[5].length ? '<span class="rx">' + w[5].map(function (x) { return '<span>' + x + '</span>'; }).join('') + '</span>' : '');
    feed.insertBefore(el, feed.children[1] || null);
    while (feed.children.length > 5) feed.removeChild(feed.lastChild);
  }
  for (var k = 0; k < 4; k++) add();
  if (!still) spWhenSeen(feed, function () { setInterval(function () { if (!document.hidden) add(); }, 2600); });
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
  spWhenSeen(box, round);
})();

// open right now: the events open on Super Pools this minute, read from the app's own list with the publishable key,
// each with a countdown to its next lock. If the list can't be read, the board shows the seasons that are always on.
// A sport page's board (#now data-sport: nhl, nfl, nba or soccer) keeps to its own sport and leaves out the questions
// card; when the list has nothing for that sport, its always-on season stands in.
// The countdown ticks outside any live region; only the count in #now-tag is announced.
(function () {
  var box = document.getElementById('now'); if (!box) return;
  var tag = document.getElementById('now-tag');
  var SPORT = box.getAttribute('data-sport') || '';
  var APP = 'https://app.superpoolsai.com/#/new';
  var KEY = 'sb_publishable_AMcluryqKenfAO6vFJ2f1A_50DhQz1b';
  var SRC = box.getAttribute('data-src') || '';
  var KIND = { pickem: "Pick'em", survivor: 'Last one standing', score: 'Call the score', streak: 'Daily streak', props: 'Prop sheet', players: 'Box pool',
    series: 'Series calls', rank: 'Rank the teams', bracket: 'Bracket', sweep: 'Sweepstake', squares: 'Squares', wins: 'Win totals' };
  // the badge's short name; every badge is drawn the same (Boards, ink text), so no colour lives here
  var LOOK = { nhl: 'NHL', nfl: 'NFL', mlb: 'MLB', nba: 'NBA', epl: 'EPL', mls: 'MLS', wsl: 'WSL', nwsl: 'NWSL', ncaa: 'NCAA', ncaam: 'NCAA', soccer: 'FC' };
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  // the competition's sport: the list says so; the built-in seasons and older rows go by the competition's prefix
  var SOCCER = { epl: 1, mls: 1, wsl: 1, nwsl: 1, ucl: 1, premier: 1 };
  function sportOf(e) {
    if (e.sport) return e.sport;
    var c = String(e.competition || e.pack || '').split('-')[0];
    return SOCCER[c] ? 'soccer' : c;
  }
  function look(e) { return LOOK[e.competition] || LOOK[(e.competition || '').split('-')[0]] || LOOK[e.sport] || 'GO'; }
  function link(raw) { if (SRC) raw += '&src=' + encodeURIComponent(SRC); return window.spDecorateAppHref ? window.spDecorateAppHref(raw) : raw; }
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
    var href = link(e.pack ? APP + '?pack=' + encodeURIComponent(e.pack) : APP + '?comp=' + encodeURIComponent(e.competition));
    var kinds = (e.kinds || []).map(function (k) { return KIND[k] || k; });
    if (e.pack) kinds.push('Questions');
    var m = matches(e);
    var name = e.open_round && e.open_round === e.final_round && (e.grids || []).length ? 'The ' + String(e.final_label).replace(/^The /, '') : e.name;
    return '<a class="ev" href="' + esc(href) + '">'
      + '<div class="top"><span class="badge" aria-hidden="true">' + esc(look(e)) + '</span><div><h3>' + esc(name) + '</h3><div class="evstage">' + esc(e.stage || e.open_label || '') + '</div></div></div>'
      + (e.next_lock ? '<div class="lock" data-at="' + Date.parse(e.next_lock) + '"><span>Next lock in</span><b>' + (left(Date.parse(e.next_lock) - Date.now()) || 'Live') + '</b></div>' : '<div class="lock"><b>Open</b></div>')
      + (m.length ? '<div class="match">' + m.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '')
      + (kinds.length ? '<div class="kinds">' + kinds.map(function (k) { return '<span>' + esc(k) + '</span>'; }).join('') + '</div>' : '')
      + '<span class="go">Start a pool on it</span></a>';
  }
  function tick() {
    if (document.hidden) return;
    box.querySelectorAll('.lock[data-at]').forEach(function (l) {
      var t = left(Number(l.getAttribute('data-at')) - Date.now());
      if (t) l.querySelector('b').textContent = t;
      else { l.classList.add('live'); l.innerHTML = '<span>Under way</span><b>Live</b>'; l.removeAttribute('data-at'); }
    });
  }
  var always = [
    { name: 'NHL 2026-27', competition: 'nhl-2026', sport: 'nhl', stage: 'The regular season', kinds: ['players'] },
    { name: 'NBA 2026-27', competition: 'nba-2026-27', sport: 'nba', stage: 'Every week of the season', kinds: ['pickem', 'survivor', 'streak'] },
    { name: 'NFL', competition: 'nfl', sport: 'nfl', stage: 'Every week of the season', kinds: ['pickem', 'survivor', 'props', 'streak'] },
    { name: 'Premier League', competition: 'epl', sport: 'soccer', stage: 'Every matchweek', kinds: ['pickem', 'survivor', 'score', 'streak'] }
  ];
  // baseball stays off every board while its page is withdrawn (landing/_redirects: no licensed feed yet)
  function mine(list) { return list.filter(function (e) { var s = sportOf(e); return SPORT ? s === SPORT : s !== 'mlb'; }); }
  function draw(list, real) {
    list = mine(list);
    if (!list.length) { list = mine(always); real = false; }
    // an event reaching its final within two weeks first, then the soonest lock
    var soon = function (e) { return e.final_starts && Date.parse(e.final_starts) - Date.now() < 14 * 864e5 ? 0 : 1; };
    list.sort(function (a, b) { return soon(a) - soon(b) || (Date.parse(a.next_lock) || 9e15) - (Date.parse(b.next_lock) || 9e15); });
    var ask = link(APP + '?type=questions');
    box.innerHTML = list.map(card).join('') + (SPORT ? '' : '<a class="ev" href="' + esc(ask) + '"><div class="top"><span class="badge" aria-hidden="true">ASK</span><div><h3>Anything else</h3><div class="evstage">The show you\'re watching, the office, the family</div></div></div>'
      + '<div class="lock"><b>Your call</b></div><div class="kinds"><span>Your own questions</span><span>Your own rules</span></div><span class="go">Ask your own questions</span></a>');
    // one card takes the rail's whole width, and there is nothing to swipe for
    var one = box.children.length === 1, swipe = box.nextElementSibling;
    box.classList.toggle('one', one);
    if (swipe && swipe.classList.contains('swipe')) swipe.hidden = one;
    if (tag) tag.textContent = real ? list.length + (list.length === 1 ? ' event open now' : ' events open now') : 'Open all season';
  }
  fetch('https://quakdkzdafzlhgjvmypg.supabase.co/rest/v1/rpc/pool_event_list', { method: 'POST', headers: { apikey: KEY, 'Content-Type': 'application/json' }, body: '{}' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) { if (!Array.isArray(d) || !d.length) throw new Error('empty'); draw(d, true); })
    .catch(function () { draw(always, false); });
  setInterval(tick, 1000);
})();

// The Traitors door closes with its pack (the last question closes 19 November 2026, 8 pm ET): from 20 November the
// page sends its visitors to the show pools page, keeping any campaign tags (docs/CLAIMS-AUDIT-2026-11-04.md).
(function () {
  if (!/\/traitors(\.html)?$/.test(location.pathname)) return;
  if (Date.now() < Date.UTC(2026, 10, 20, 5)) return;
  location.replace('./together.html' + location.search);
})();

// The founding league's record ([data-proof]), read live from the app's proof_counts() (migration 350): the scored
// calls, the average miss, the share within two points and the game nights with a morning column the next day. The
// page carries the numbers as of its last edit, so a failed read leaves them as they were.
(function () {
  var els = document.querySelectorAll('[data-proof]'); if (!els.length || !window.fetch) return;
  fetch('https://quakdkzdafzlhgjvmypg.supabase.co/rest/v1/rpc/proof_counts', { method: 'POST',
    headers: { apikey: 'sb_publishable_AMcluryqKenfAO6vFJ2f1A_50DhQz1b', 'Content-Type': 'application/json' }, body: '{}' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      if (!d || !(d.calls > 0) || !(d.nights > 0)) return;
      var v = {
        calls: Number(d.calls).toLocaleString('en-US'),
        avg_miss: Number(d.avg_miss).toFixed(1),
        within_two: Math.round(Number(d.within_two)) + '%',
        nights: d.nights_with_column + ' of ' + d.nights
      };
      els.forEach(function (el) { var k = el.getAttribute('data-proof'); if (v[k]) el.textContent = v[k]; });
    })
    .catch(function () { /* the page's own numbers stand */ });
})();

// The change log's latest lines (#loglines), from /changelog-latest.json (the four newest entries, a few hundred bytes;
// the whole log is changelog.json), which scripts/landing-changelog.mjs writes from the app's own src/data/changelog.ts.
// The page carries the same lines as static HTML, so this only refreshes them.
(function () {
  var list = document.getElementById('loglines'); if (!list || !window.fetch) return;
  var n = Number(list.getAttribute('data-n') || 4);
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var esc = function (x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  fetch('./changelog-latest.json', { cache: 'no-cache' })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) {
      var rows = (d && d.entries || []).slice(0, n); if (!rows.length) return;
      list.innerHTML = rows.map(function (e) {
        var p = String(e.date).split('-');
        return '<li><time datetime="' + esc(e.date) + '">' + MON[Number(p[1]) - 1] + ' ' + Number(p[2]) + '</time><div><b>' + esc(e.title) + '</b>' + (e.line && list.hasAttribute('data-detail') ? '<span>' + esc(e.line) + '</span>' : '') + '</div></li>';
      }).join('');
    })
    .catch(function () { /* the static lines stay */ });
})();

// Love Is Blind Season 11 by the calendar (Netflix drops at 3 am ET; the reunion airs live at 9 pm ET): the countdown
// counts to whatever is next, and once the pods are open the copy written for before the premiere says what's next
// instead. An element with data-next holds a template ({next} is what happens, "drop 2 lands", {date} the Eastern date it
// happens on, "October 21"); it keeps its own words until the premiere has aired, and data-done takes over once the last
// stage has passed. The last stage is the reunion going on air: the pack's reunion question stays open in the database
// until 11 November 08:00Z, but from the reunion on the pages say Season 11 is over and never invite that call.
var LIB_STAGES = [
  { at: Date.UTC(2026, 9, 14, 7), next: 'the pods open', date: 'October 14' },
  { at: Date.UTC(2026, 9, 21, 7), next: 'drop 2 lands', date: 'October 21' },
  { at: Date.UTC(2026, 9, 28, 7), next: 'drop 3 lands', date: 'October 28' },
  { at: Date.UTC(2026, 10, 4, 8), next: 'the weddings land', date: 'November 4' },
  { at: Date.UTC(2026, 10, 9, 2), next: 'the reunion airs', date: 'November 8' },
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
    if (i < 0) { box.innerHTML = '<div style="min-width:auto;padding:10px 14px"><b style="font-size:24px">Season 11 ended with the reunion</b></div>'; return; }
    var ms = Math.max(0, LIB_STAGES[i].at - Date.now()), d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
    box.querySelector('[data-u=d]').textContent = d; box.querySelector('[data-u=h]').textContent = String(h).padStart(2, '0'); box.querySelector('[data-u=m]').textContent = String(m).padStart(2, '0');
  }
  tick(); setInterval(tick, 30000);
})();

// The waitlist writes straight to the database through its public API; the key below is the publishable one and can
// only insert into the waitlist table (see supabase/migrations/20261005000061_waitlist.sql; the UTM columns, 241).
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
    var body = Object.assign({ email: email, league: pick, note: note || null, source: (location.hostname + location.pathname).slice(0, 120) }, spAttribution());
    fetch(API, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 201) { msg.className = 'msgline ok wide'; msg.textContent = 'You are on the list. We will write when your pool can open.'; form.reset(); }
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
