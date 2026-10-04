// Super Pools landing pages: the reveal on scroll, the live board and the try-it question (both fictional, drawn in
// the page), the premiere countdown, and the waitlist. Every piece checks its element exists, so each page uses what it has.
document.documentElement.classList.add('js');
var still = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  var plays = [
    ['Top Shelf', 3.0, 'McDavid scores on the power play'], ['Hat Trick Club', 2.0, 'Makar assist, his second tonight'],
    ['Zamboni Drivers', 4.6, 'Shesterkin stops 38 for the win'], ['Five Hole Heroes', 1.5, 'Pastrnak: 6 shots, a goal disallowed'],
    ['Hat Trick Club', 3.0, 'MacKinnon goal, 1:12 into the third'], ['Top Shelf', 1.0, 'Hughes power-play assist'],
    ['Five Hole Heroes', 3.5, 'Kaprizov from the slot'], ['Zamboni Drivers', 2.0, 'Kucherov to Point, again']
  ];
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

// the premiere countdown: Love Is Blind Season 11 drops Wednesday 14 October 2026 at 3 am ET (07:00 UTC)
(function () {
  var box = document.getElementById('premiere'); if (!box) return;
  var at = Date.UTC(2026, 9, 14, 7, 0, 0);
  function tick() {
    var ms = Math.max(0, at - Date.now()), d = Math.floor(ms / 864e5), h = Math.floor(ms % 864e5 / 36e5), m = Math.floor(ms % 36e5 / 6e4);
    if (ms === 0) { box.innerHTML = '<div style="min-width:auto;padding:10px 14px"><b style="font-size:24px">The pods are open</b></div>'; return; }
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
    fetch(API, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ email: email, league: pick, note: note || null, source: (location.hostname + location.pathname).slice(0, 120) })
    }).then(function (r) {
      if (r.status === 201) { msg.className = 'msgline ok wide'; msg.textContent = pick === 'Love Is Blind pool' ? 'You are on the list. Your invite comes before the pods open.' : 'You are on the list. We will write when your pool can open.'; form.reset(); }
      else if (r.status === 409) { msg.className = 'msgline ok wide'; msg.textContent = 'You were already on the list. We have not forgotten.'; }
      else { msg.className = 'msgline err wide'; msg.innerHTML = fallback; }
    }).catch(function () { msg.className = 'msgline err wide'; msg.innerHTML = fallback; })
      .finally(function () { btn.disabled = false; });
  });
})();
