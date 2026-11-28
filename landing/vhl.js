// The vHL (V Hockey League) concept page (vhl.html), after site.js: the V's turn in the name, the film's play button, the lead player's living
// portrait, the map, the members' vote and the sealed game. Every demo is fictional and drawn in the page; each part checks its element exists, and without this
// script the page still reads whole (the film keeps its own controls, the vote shows its result).
(function () {
  'use strict';
  var still = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var $ = function (id) { return document.getElementById(id); };
  var each = function (sel, fn, root) { Array.prototype.forEach.call((root || document).querySelectorAll(sel), fn); };

  // 0. The name. On arrival the V takes its turns (virtual, vibrant, valiant, vivacious) and lands back on V: once,
  // and not at all for anyone who asked for less motion. A screen reader gets "V Hockey League" throughout.
  (function () {
    var el = $('vflip');
    if (!el || still) return;
    var words = ['Virtual', 'Vibrant', 'Valiant', 'Vivacious', 'V'], i = -1;
    var turn = function () {
      el.classList.add('out');
      setTimeout(function () {
        i += 1; el.textContent = words[i]; el.classList.remove('out');
        if (i < words.length - 1) setTimeout(turn, 740);
      }, 160);
    };
    setTimeout(turn, 1300);
  })();

  // 1. The film. The poster carries one large button; the player's own controls take over once it starts. Nothing is
  // downloaded until someone asks for it (preload="none").
  (function () {
    var film = $('vhl-film'), play = $('film-play'), box = $('film');
    if (!film || !play || !box) return;
    film.removeAttribute('controls');
    play.hidden = false;
    var start = function () {
      play.hidden = true;
      film.setAttribute('controls', '');
      var p = film.play();
      if (p && p.catch) p.catch(function () { /* the player's own button is there if the browser refuses */ });
    };
    play.addEventListener('click', start);
    film.addEventListener('play', function () { play.hidden = true; film.setAttribute('controls', ''); });
    each('[data-film]', function (a) {
      a.addEventListener('click', function (e) {
        e.preventDefault();
        box.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'center' });
        start();
      });
    });
  })();

  // 1b. The lead player's portrait: a five-second clip, played once without sound the first time it is seen (he looks
  // up and smiles), and again on a tap. With reduced motion, or on a data-saving connection, the still stays.
  (function () {
    var v = $('okafor-look');
    if (!v || still || !('IntersectionObserver' in window)) return;
    var saver = navigator.connection && navigator.connection.saveData;
    var go = function () { try { v.currentTime = 0; } catch (e) { /* not loaded yet */ } var p = v.play(); if (p && p.catch) p.catch(function () { /* the still stays */ }); };
    v.addEventListener('click', go);
    if (saver) return;
    var io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) { io.disconnect(); go(); } }, { threshold: 0.6 });
    io.observe(v);
  })();

  // 2. The map. A city is picked from the twelve buttons or by touching its dot; the row of chips dims the other kinds.
  (function () {
    var map = $('map'), read = $('map-read');
    if (!map || !read) return;
    var base = read.innerHTML, cur = null;
    var pick = function (name) {
      var hit = null;
      each('.city', function (g) { var on = name !== null && g.getAttribute('data-city') === name; g.classList.toggle('on', on); if (on) hit = g; }, map);
      each('.citybtn', function (b) { var on = name !== null && b.getAttribute('data-city') === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
      cur = hit ? name : null;
      if (!hit) { read.innerHTML = base; return; }
      hit.parentNode.appendChild(hit); // drawn last, so it sits over its neighbours
      var b = document.createElement('b'), s = document.createElement('span');
      b.textContent = name; s.textContent = hit.getAttribute('data-note');
      read.textContent = ''; read.appendChild(b); read.appendChild(s);
    };
    var cityOf = function (e) { var g = e.target && e.target.closest ? e.target.closest('.city') : null; return g ? g.getAttribute('data-city') : null; };
    map.addEventListener('click', function (e) { var n = cityOf(e); pick(n !== null && n === cur ? null : n); });
    map.addEventListener('pointerover', function (e) { if (e.pointerType === 'mouse') { var n = cityOf(e); if (n !== null && n !== cur) pick(n); } });
    each('.citybtn', function (b) {
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () { var n = b.getAttribute('data-city'); pick(n === cur ? null : n); });
    });
    each('.chipbtn', function (c) {
      c.addEventListener('click', function () {
        var v = c.getAttribute('data-show');
        each('.chipbtn', function (o) { o.setAttribute('aria-pressed', o === c ? 'true' : 'false'); });
        map.classList.remove('show-t0', 'show-t1', 'show-t2');
        if (v !== 'all') map.classList.add('show-' + v);
        pick(null);
      });
    });
  })();

  // 3. The members' vote. The result is the story's (58 to 42, the trade goes through) whichever way the visitor votes;
  // the page says which side they were on.
  (function () {
    var vote = $('vote'), foot = $('vote-foot');
    if (!vote || !foot) return;
    var result = foot.textContent;
    foot.textContent = 'The vote closes at the deadline. 23,480 members have voted so far.';
    vote.addEventListener('click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('[data-vote]') : null;
      if (!b || vote.classList.contains('done')) return;
      var yes = b.getAttribute('data-vote') === 'yes';
      vote.classList.add('done');
      var row = vote.querySelector(yes ? '.vb.yes' : '.vb.no');
      if (row) row.classList.add('mine');
      foot.textContent = result + (yes ? ' You voted with the 58 percent.' : ' You voted with the 42 percent.');
      var w = $('wire-new');
      if (w) w.hidden = false;
    });
  })();

  // 4. The sealed game: a random seed, its SHA-256 fingerprint shown first, a small game played from the seed alone,
  // then the seed shown and checked against the fingerprint. A toy of the idea, not the league's engine.
  (function () {
    var seal = $('seal'), btn = $('seal-btn'), again = $('seal-again');
    if (!seal || !btn || !again) return;
    var elHash = $('seal-hash'), elSeed = $('seal-seed'), elScore = $('seal-score'), elLog = $('seal-log'), elOk = $('seal-ok');
    var steps = seal.querySelectorAll('.seal-steps li');

    var rotr = function (x, n) { return (x >>> n) | (x << (32 - n)); };
    var prime = function (n) { for (var f = 2; f * f <= n; f++) if (n % f === 0) return false; return true; };
    var frac = function (x) { return ((x - Math.floor(x)) * 4294967296) | 0; };
    var K = [], H0 = [];
    for (var c = 2, k = 0; k < 64; c++) if (prime(c)) { if (k < 8) H0[k] = frac(Math.sqrt(c)); K[k++] = frac(Math.cbrt ? Math.cbrt(c) : Math.pow(c, 1 / 3)); }
    var sha256 = function (bytes) {
      var m = bytes.slice(), bits = bytes.length * 8, H = H0.slice(), w = new Array(64), i, o;
      m.push(128); while (m.length % 64 !== 56) m.push(0);
      m.push(0, 0, 0, 0, (bits >>> 24) & 255, (bits >>> 16) & 255, (bits >>> 8) & 255, bits & 255);
      for (o = 0; o < m.length; o += 64) {
        for (i = 0; i < 16; i++) w[i] = (m[o + 4 * i] << 24) | (m[o + 4 * i + 1] << 16) | (m[o + 4 * i + 2] << 8) | m[o + 4 * i + 3];
        for (i = 16; i < 64; i++) {
          var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3), s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        var a = H[0], b = H[1], cc = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (i = 0; i < 64; i++) {
          var t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
          var t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & cc) ^ (b & cc))) | 0;
          h = g; g = f; f = e; e = (d + t1) | 0; d = cc; cc = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + cc) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
      }
      return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
    };
    var hex = function (bytes) { return bytes.map(function (x) { return ('0' + x.toString(16)).slice(-2); }).join(''); };
    var newSeed = function () {
      var out = [], i;
      if (window.crypto && window.crypto.getRandomValues) { var u = new Uint8Array(16); window.crypto.getRandomValues(u); for (i = 0; i < 16; i++) out.push(u[i]); }
      else for (i = 0; i < 16; i++) out.push(Math.floor(Math.random() * 256));
      return out;
    };
    // every number the game needs comes from the seed, in order, so the same seed always plays the same game
    var dice = function (bytes) {
      var a = (bytes[0] << 24 | bytes[1] << 16 | bytes[2] << 8 | bytes[3]) ^ (bytes[4] << 24 | bytes[5] << 16 | bytes[6] << 8 | bytes[7]);
      var b = (bytes[8] << 24 | bytes[9] << 16 | bytes[10] << 8 | bytes[11]) ^ (bytes[12] << 24 | bytes[13] << 16 | bytes[14] << 8 | bytes[15]);
      a = (a ^ Math.imul(b, 0x9E3779B1)) | 0;
      return function () { a = (a + 0x6D2B79F5) | 0; var t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    };
    var ROSTER = { HFX: ['Okafor', 'Halvorsen', 'Bellamy', 'Whitlock', 'Sandhu', 'MacIsaac'], QUE: ['Desrosiers', 'Valcourt', 'Thibodeau', 'Lindahl', 'Okonjo', 'Brassard-Roy'] };
    var NAME = { HFX: 'Halifax', QUE: 'Québec' };
    var play = function (bytes) {
      var r = dice(bytes), goals = [], score = { HFX: 0, QUE: 0 }, p, t, n, i;
      var many = function (mean) { var L = Math.exp(-mean), q = 1, c2 = 0; do { c2++; q *= r(); } while (q > L); return c2 - 1; };
      var who = function (team) { var x = r(); return ROSTER[team][Math.min(5, Math.floor(x * x * 6))]; };
      for (p = 1; p <= 3; p++) ['HFX', 'QUE'].forEach(function (team) {
        n = many(team === 'HFX' ? 1.02 : 0.96);
        for (i = 0; i < n; i++) goals.push({ p: p, s: Math.floor(r() * 1200), team: team, who: who(team) });
      });
      goals.sort(function (x, y) { return x.p - y.p || x.s - y.s; });
      goals.forEach(function (g2) { score[g2.team]++; g2.hfx = score.HFX; g2.que = score.QUE; });
      var ot = score.HFX === score.QUE;
      if (ot) { t = r() < 0.5 ? 'HFX' : 'QUE'; score[t]++; goals.push({ p: 4, s: Math.floor(r() * 300), team: t, who: who(t), hfx: score.HFX, que: score.QUE }); }
      return { goals: goals, hfx: score.HFX, que: score.QUE, ot: ot };
    };
    var clock = function (g2) { var mm = Math.floor(g2.s / 60), ss = g2.s % 60; return (g2.p === 4 ? 'OT' : ['1st', '2nd', '3rd'][g2.p - 1]) + ' ' + mm + ':' + (ss < 10 ? '0' : '') + ss; };
    var setScore = function (que, hfx, label) {
      var b = elScore.querySelectorAll('.tm b'), per = elScore.querySelector('.per');
      b[0].textContent = que; b[1].textContent = hfx; per.textContent = label;
    };
    var line = function (text, time, bold) {
      var li = document.createElement('li');
      if (time) { var tm = document.createElement('time'); tm.textContent = time; li.appendChild(tm); }
      if (bold) { var b = document.createElement('b'); b.textContent = bold; li.appendChild(b); li.appendChild(document.createTextNode(' ')); }
      li.appendChild(document.createTextNode(text));
      elLog.appendChild(li);
    };
    var step = function (n) { for (var i = 0; i < steps.length; i++) steps[i].classList.toggle('on', i < n); };

    var seed = null, sealed = '', state = 0, timer = null;
    var run = function (done) {
      var game = play(seed), i = 0;
      elLog.textContent = '';
      setScore(0, 0, 'Puck drop');
      var finish = function () {
        if (!game.goals.length) line('No goals in sixty minutes.', '', '');
        setScore(game.que, game.hfx, game.ot ? 'Final, overtime' : 'Final');
        line((game.hfx > game.que ? NAME.HFX : NAME.QUE) + ' wins ' + Math.max(game.hfx, game.que) + ' to ' + Math.min(game.hfx, game.que) + (game.ot ? ' in overtime.' : '.'), '', '');
        done();
      };
      var next = function () {
        if (i >= game.goals.length) { finish(); return; }
        var g2 = game.goals[i++];
        line('scores for ' + NAME[g2.team] + '.', clock(g2), g2.who);
        setScore(g2.que, g2.hfx, g2.p === 4 ? 'Overtime' : ['1st', '2nd', '3rd'][g2.p - 1] + ' period');
        if (still) next(); else timer = setTimeout(next, 420);
      };
      if (still) next(); else timer = setTimeout(next, 350);
    };
    var reset = function () {
      clearTimeout(timer); seed = null; sealed = ''; state = 0; step(0);
      elHash.textContent = 'Not sealed yet'; elSeed.textContent = 'Hidden until the horn'; elOk.hidden = true; again.hidden = true;
      elLog.textContent = ''; line('Seal a game to start.', '', ''); setScore(0, 0, 'Before the game');
      btn.textContent = 'Seal a game'; btn.disabled = false;
    };
    btn.addEventListener('click', function () {
      if (state === 0) {
        seed = newSeed(); sealed = sha256(seed);
        elHash.textContent = sealed; elLog.textContent = ''; line('Sealed. The seed is hidden; its fingerprint is public.', '', '');
        state = 1; step(1); btn.textContent = 'Drop the puck';
      } else if (state === 1) {
        btn.disabled = true; step(2);
        run(function () { btn.disabled = false; btn.textContent = 'Open the seal'; state = 2; });
      } else if (state === 2) {
        elSeed.textContent = hex(seed);
        var ok = sha256(seed) === sealed;
        elOk.hidden = !ok; step(3); state = 3; btn.textContent = 'Seal another game'; again.hidden = false;
      } else reset();
    });
    again.addEventListener('click', function () {
      if (state !== 3 || !seed) return;
      clearTimeout(timer); btn.disabled = true; again.disabled = true;
      run(function () { btn.disabled = false; again.disabled = false; });
    });
    step(0);
    // for the page's own checks: the fingerprint of an empty message is a published constant
    seal.setAttribute('data-sha', sha256([]) === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' ? 'ok' : 'bad');
  })();
})();
