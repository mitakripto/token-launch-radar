// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, filters, a per-protocol detail view with the model's own breakdown and
// the protocol's farm plan, the live-token comps and the fitted model's validation. No network:
// every byte it shows is in data.js. The page recomputes each row's implied value from the snapshot
// figures and the fitted parameters, so the code and the board's data are visibly the same arithmetic.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var FARM = window.RADAR_FARM;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tvl: 'all', odds: 'all', tab: 'board', sort: 'implied', dir: -1, selected: null };

  var usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd.format(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtOdds(o) { return Math.round(o * 100) + '%'; }
  function fmtCost(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (n > 0 && n < 1) return '$' + n.toFixed(2);
    return fmtUsd(n);
  }
  function fmtPerHour(n) {
    if (n === null || n === undefined || !isFinite(n) || n <= 0) return '$0/h';
    if (n >= 100) return '$' + Math.round(n) + '/h';
    if (n >= 1) return '$' + n.toFixed(1) + '/h';
    return '$' + n.toFixed(2) + '/h';
  }

  // The fitted model, as the page recomputes it: log10(value at launch) = a + b log10(tvl) +
  // peerAdj, and nothing else. The launch odds are reported beside the value, never multiplied
  // into it. The peer adjustment comes from the peer table main.ts fitted.
  var PEERS = {};
  DATA.peers.forEach(function (p) { PEERS[p.category] = p; });
  function impliedOf(row) {
    var fit = DATA.fit;
    var peer = PEERS[row.category || 'Uncategorised'];
    var adj = peer ? peer.peer_adj_log10 : 0;
    var implied = Math.pow(10, fit.intercept + fit.slope * Math.log10(Math.max(row.tvl_usd, 1)) + adj);
    return { implied: Math.max(1, Math.round(implied)), peerAdj: adj };
  }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tvl')) state.tvl = params.get('tvl');
    if (params.get('odds')) state.odds = params.get('odds');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tvl !== 'all') params.set('tvl', state.tvl);
    if (state.odds !== 'all') params.set('odds', state.odds);
    if (state.tab !== 'board') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function tvlBand(r) {
    if (state.tvl === 'billion') return r.tvl_usd >= 1e9;
    if (state.tvl === 'hundred') return r.tvl_usd >= 1e8 && r.tvl_usd < 1e9;
    if (state.tvl === 'ten') return r.tvl_usd >= 1e7 && r.tvl_usd < 1e8;
    if (state.tvl === 'small') return r.tvl_usd < 1e7;
    return true;
  }
  function oddsBand(r) {
    if (state.odds === 'high') return r.token_odds >= 0.6;
    if (state.odds === 'mid') return r.token_odds >= 0.4 && r.token_odds < 0.6;
    if (state.odds === 'low') return r.token_odds < 0.4;
    return true;
  }
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!tvlBand(r) || !oddsBand(r)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'odds') { av = a.token_odds; bv = b.token_odds; }
      else if (key === 'farm') { av = a.farm_value_per_hour_usd; bv = b.farm_value_per_hour_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' fitted model' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('h1', { text: DATA.watchlist_size + ' watchlist protocols, ranked by value at launch' }),
      el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor. Implied value is the value at launch: what a protocol\u2019s token would be worth if it issued one, fitted from the market caps of protocols whose tokens already trade. The launch odds printed beside it are never folded into it. It is a model, not a promise.' })
    );
  }

  function kpis() {
    var top = DATA.rows[0];
    return el('section', { class: 'kpis' },
      el('div', { class: 'kpi' }, el('span', { text: 'Watchlist covered' }), el('b', { html: DATA.watchlist_size + ' / ' + DATA.watchlist_size + ' <em>complete</em>' })),
      el('div', { class: 'kpi' }, el('span', { text: 'Pre-token rows ranked' }), el('b', { text: String(DATA.board_size) })),
      el('div', { class: 'kpi' }, el('span', { text: 'Top value at launch' }), el('b', { text: fmtUsd(top ? top.implied_value_usd : 0) })),
      el('div', { class: 'kpi' }, el('span', { text: 'Live-token protocols set aside' }), el('b', { text: String(DATA.accounting.live) }))
    );
  }

  function integrity() {
    var a = DATA.accounting;
    var excluded = a.excluded.map(function (e) { return e.count + ' ' + e.reason; }).join(', ');
    var totalExcluded = a.excluded.reduce(function (n, e) { return n + e.count; }, 0);
    return el('section', { class: 'integrity' },
      el('span', { html: '<b>Integrity:</b> all ' + a.total + ' snapshot protocols accounted for: <b>' + a.ranked + ' ranked</b> (' + a.watchlist + ' watchlist + ' + a.early + ' early), <b>' + a.live + ' live-token</b> set aside with their market caps, <b>' + totalExcluded + ' excluded</b> (' + excluded + '). ' }),
      el('span', { class: 'ok', text: 'Ranks 1-' + a.ranked + ' - values non-rising - every value carries its 80% range from held-out residuals - every row carries a 6-step farm plan.' })
    );
  }

  function selectField(id, label, options, value, onChange) {
    var select = el('select', { id: id, 'aria-label': label },
      options.map(function (o) { return el('option', { value: o[0], text: o[1], selected: o[0] === value ? 'selected' : null }); })
    );
    select.addEventListener('change', function () { onChange(select.value); writeHash(); render(); });
    return el('div', { class: 'field' }, el('label', { for: id, text: label }), select);
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorised'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    function tabBtn(tab, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === tab ? 'true' : 'false', text: label, onclick: function () { state.tab = tab; writeHash(); render(); } });
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      selectField('category', 'Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; }),
      selectField('chain', 'Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; }),
      selectField('tvl', 'TVL', [['all', 'Any TVL'], ['billion', '$1B+'], ['hundred', '$100M-$1B'], ['ten', '$10M-$100M'], ['small', 'Under $10M']], state.tvl, function (v) { state.tvl = v; }),
      selectField('odds', 'Launch odds', [['all', 'Any odds'], ['high', 'High (60%+)'], ['mid', 'Mid (40-60%)'], ['low', 'Low (under 40%)']], state.odds, function (v) { state.odds = v; }),
      el('div', { class: 'field' }, el('span', { class: 'lbl', text: 'View' }),
        el('div', { class: 'tabs' }, tabBtn('board', 'Board'), tabBtn('live', 'Live token'), tabBtn('peers', 'Peer multiples'), tabBtn('method', 'Method'))),
      el('span', { class: 'count', text: state.tab === 'board' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : state.tab === 'live' ? DATA.live.length + ' live-token protocols' : state.tab === 'peers' ? DATA.peers.length + ' categories with live peers' : 'How the model is fitted and checked' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function emptyPanel() {
    return el('div', { class: 'panel' }, el('div', { class: 'empty' },
      el('h2', { text: 'No protocol matches that filter' }),
      el('p', { text: 'Clear the search or widen the filters to see the board again.' }),
      el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvl = 'all'; state.odds = 'all'; writeHash(); render(); } })
    ));
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) return emptyPanel();
    var max = 0;
    list.forEach(function (r) { if (r.implied_value_usd > max) max = r.implied_value_usd; });
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num odds', text: fmtOdds(r.token_odds) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) }),
          el('span', { class: 'sub', text: fmtUsd(r.value_low_usd) + ' to ' + fmtUsd(r.value_high_usd) })
        )),
        el('td', null, el('div', { class: 'implied' },
          el('span', { class: 'num', text: fmtPerHour(r.farm_value_per_hour_usd) }),
          el('span', { class: 'sub', text: 'min ' + fmtUsd(r.min_capital_usd) + ' - ' + fmtCost(r.farm_cost_usd) + ' gas' })
        )),
        el('td', null, el('span', { class: 'pill', text: 'no token' }))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest value at launch first. The odds column is the launch chance from the peers\u2019 record; it does not change the value. Select a row for its model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            sortHeader('age', 'Age'),
            sortHeader('odds', 'Odds'),
            sortHeader('implied', 'Value at launch'),
            sortHeader('farm', 'Farm $/h'),
            el('th', { scope: 'col', text: 'Token' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', { tabindex: '0' },
        el('td', null, el('span', { class: 'pill live', text: 'live' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Uncategorised') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.multiple === null ? 'n/a' : r.multiple.toFixed(2) + 'x' })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. The top 40 by market cap are shown; the full live set of ' + DATA.accounting.live + ' is what the model is fitted on.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', text: 'TVL' }), el('th', { scope: 'col', text: '7d' }), el('th', { scope: 'col', text: 'Market cap' }), el('th', { scope: 'col', text: 'Mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function peersTable() {
    var list = DATA.peers.slice().sort(function (a, b) { return b.median_multiple - a.median_multiple; });
    var tbody = el('tbody');
    list.forEach(function (p) {
      tbody.appendChild(el('tr', { tabindex: '0' },
        el('td', null, el('b', { text: p.category })),
        el('td', { class: 'num', text: String(p.n_live) }),
        el('td', { class: 'num', text: p.median_multiple.toFixed(2) + 'x' }),
        el('td', { class: 'num', text: (p.peer_adj_log10 >= 0 ? '+' : '') + p.peer_adj_log10.toFixed(2) }),
        el('td', { class: 'num odds', text: fmtOdds(p.token_odds) }),
        el('td', { class: 'num', text: String(p.odds_n) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Each category fitted from its own live-token protocols: the median mcap/TVL multiple, shrunk toward the global median of ' + DATA.fit.global_median_multiple.toFixed(2) + 'x, and the launch odds from the peers at or above the $50M floor.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Category' }), el('th', { scope: 'col', text: 'Live peers' }), el('th', { scope: 'col', text: 'Median multiple' }), el('th', { scope: 'col', text: 'Peer adj (log10)' }), el('th', { scope: 'col', text: 'Launch odds' }), el('th', { scope: 'col', text: 'Peers at floor' }))),
          tbody
        )
      )
    );
  }

  function methodPanel() {
    var f = DATA.fit;
    var v = DATA.validation;
    var cvx = Math.pow(10, v.cv.median_abs_log10).toFixed(1);
    var basex = Math.pow(10, v.cv.baseline_median_abs_log10).toFixed(1);
    var wfx = Math.pow(10, v.walk_forward.median_abs_log10).toFixed(1);
    var loox = Math.pow(10, v.loo.median_abs_log10).toFixed(1);
    var bandx = Math.pow(10, v.range.global_half_width_log10).toFixed(1);
    var pts = f.age_curve.points;
    var young = pts[0], old = pts[pts.length - 1];
    var ablRows = v.ablation.map(function (a) {
      return el('tr', null,
        el('td', { text: a.label }),
        el('td', { class: 'num', text: Math.pow(10, a.median_abs_log10).toFixed(1) + 'x ' + (a.variant === 'without' ? 'without it' : 'with it added') }),
        el('td', { class: 'num', text: a.verdict })
      );
    });
    return el('section', { class: 'panel method' },
      el('h2', { text: 'How the value at launch is computed' }),
      el('p', { class: 'sub', text: 'Every row is scored by one fitted function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked.' }),
      el('div', { class: 'formula' },
        'log10(value) = ' + f.intercept + ' + ' + f.slope + ' x log10(tvl) + peerAdj   (R2 ' + f.r2 + ', n = ' + f.n_fit + ' live-token protocols)\n' +
        'implied value = round(10^(...)): the value at launch, the board\u2019s number\n' +
        'range = implied widened by 10^(+/- category band) from held-out residuals\n' +
        'launch odds = category odds x ageFactor(age_days): printed beside the value, never in it'
      ),
      el('p', { class: 'sub', text: 'The size curve is a least-squares fit of market cap on TVL across the ' + f.n_fit + ' live-token protocols that carry a positive market cap; the slope below 1 is the sublinear size curve. Each category shifts the line by its median residual, shrunk toward zero. That is the whole value model: a protocol\u2019s seven-day growth, its age and its launch odds are printed on its row, and none of them moves the number.' }),
      el('p', { class: 'sub', text: 'Launch odds start from the share of protocols at or above the $50M floor in the same category that already trade (global ' + fmtOdds(f.global_odds) + '), shrunk toward the global share. The odds then decay with age. A survival curve fitted on all ' + f.age_curve.population + ' dated protocols reads the share still pre-token at each age; the oldest protocols put the never-launch floor at ' + Math.round(f.age_curve.s_inf * 100) + '%, and what remains of a protocol\u2019s launch window at its age, relative to the pre-token average, is its age factor: x' + young.factor.toFixed(2) + ' at ' + fmtAge(young.age) + ', x' + old.factor.toFixed(2) + ' at ' + fmtAge(old.age) + '. The longer a protocol has sat pre-token, the less of its launch window is left. Age is the time since the protocol was first listed; an unknown age takes the pre-token median of ' + f.median_pre_age + ' days.' }),
      el('p', { class: 'sub', text: 'Earlier versions of this model multiplied the value by the growth, maturity and odds terms. They are gone from the value, for two reasons stated plainly: a value at launch and a chance of launching are different questions, and the ablation below \u2014 each dropped term added back under the same folds \u2014 prints what each one does to the only ground truth available, market caps that already exist.' }),
      el('h3', { text: 'Validation, computed at build time on protocols the fit had not seen' }),
      el('p', { class: 'sub', text: 'Each scheme scores the board\u2019s exact printed number (the value at launch) for a live-token protocol treated as if it were pre-token, against its real market cap. Every fit inside a split sees only that split\u2019s training protocols.' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('tbody', null,
          el('tr', null, el('td', { text: '5-fold cross-validation, median error' }), el('td', { class: 'num', text: cvx + 'x (median |log10 error| ' + v.cv.median_abs_log10 + ')' })),
          el('tr', null, el('td', { text: 'Cross-validation, predictions within 2x of the market cap' }), el('td', { class: 'num', text: Math.round(v.cv.within_2x * 100) + '% of ' + v.cv.n })),
          el('tr', null, el('td', { text: 'Same folds under a flat 0.25xTVL rule' }), el('td', { class: 'num', text: basex + 'x median error' })),
          el('tr', null, el('td', { text: 'Walk-forward: fitted on protocols listed before ' + v.walk_forward.cutoff + ', tested after' }), el('td', { class: 'num', text: wfx + 'x median error, ' + Math.round(v.walk_forward.within_2x * 100) + '% within 2x (' + v.walk_forward.test_n + ' tested)' })),
          el('tr', null, el('td', { text: 'Leave-one-out: every protocol predicted by a fit that never saw it' }), el('td', { class: 'num', text: loox + 'x median error, ' + Math.round(v.loo.within_2x * 100) + '% within 2x (' + v.loo.n + ' tested)' })),
          el('tr', null, el('td', { text: 'Value range: the 80% band from cross-validated residuals' }), el('td', { class: 'num', text: 'x/' + bandx + ' typical, and it held ' + Math.round(v.range.coverage * 100) + '% of held-out market caps' }))
        )
      )),
      el('h3', { text: 'Ablation: shipped terms removed, dropped terms added back, same folds' }),
      el('div', { class: 'table-wrap' }, el('table', null,
        el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Term' }), el('th', { scope: 'col', text: 'Median error of the variant' }), el('th', { scope: 'col', text: 'Verdict' }))),
        el('tbody', null, ablRows)
      )),
      el('p', { class: 'sub', text: 'Read the ablation honestly: it tests every term as a predictor of market caps that already exist, the only ground truth the snapshot holds. The two shipped terms are removed in turn; the four dropped terms are added back in turn, and each variant\u2019s error is printed next to the shipped model\u2019s ' + cvx + 'x. Nothing is hidden either way: the growth, age and odds figures the dropped terms used are still printed on every row, and the odds still rank the farms. They are out of the value because a launch\u2019s worth and a launch\u2019s likelihood are different numbers.' }),
      el('h3', { text: 'Farm economics' }),
      el('p', { class: 'sub', text: 'Each plan\u2019s cost is its gas alone (the position capital stays in the position), and its hours are the steps\u2019 own times over the hold. The $/hour figure is a stated scenario, not a forecast: if a launch values the protocol at its value at launch and pays 5% of that to early users, split evenly over 10,000 qualifying wallets, the expected value is the launch odds times that share, divided by the plan\u2019s hours. It is the one place value and odds meet. Most launches pay nothing like it; many pay nothing at all.' }),
      el('p', { class: 'sub', text: 'Read the validation honestly: the fitted model beats a flat multiple, but market caps vary widely around TVL, so an implied value is an order-of-magnitude estimate with the range printed beside it, not a price.' })
    );
  }

  function verdictFor(row) {
    if (row.token_odds >= 0.6 && row.implied_value_usd >= 10e6) return 'Top of the radar: the peers in this category usually launch, and the value at launch is large. Farm it first.';
    if (row.implied_value_usd >= 10e6) return 'Large value at launch, but the peers in this category launch less often: sizeable if it comes, slower to arrive.';
    if (row.token_odds >= 0.6) return 'The peers usually launch, but the value at launch is modest: a cheap farm with a good chance of a small payout.';
    return 'Early and uncertain: small value at launch and peers that rarely launch. Farm it only with the minimum position.';
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = FARM.farmSteps(row);
    var recomputed = impliedOf(row);
    var agrees = recomputed.implied === row.implied_value_usd;
    var comps = DATA.comps[row.category || 'Uncategorised'] || [];
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Value if it launches' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple (' + (row.category || 'Uncategorised') + ')' }), el('b', { class: 'num', text: row.peer_multiple.toFixed(2) + 'x' })),
        el('div', null, el('span', { text: 'Peer adjustment (log10)' }), el('b', { class: 'num', text: (row.peer_adj_log10 >= 0 ? '+' : '') + row.peer_adj_log10.toFixed(2) })),
        el('div', null, el('span', { text: 'Seven-day growth (recorded, not in the value)' }), el('b', { class: 'num', text: fmtPct(row.change_7d) })),
        el('div', null, el('span', { text: 'Age with no token (recorded, not in the value)' }), el('b', { class: 'num', text: fmtAge(row.age_days) })),
        el('div', { class: 'total' }, el('span', { text: 'Value at launch' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) })),
        el('div', null, el('span', { text: 'Value range (80% band)' }), el('b', { class: 'num', text: fmtUsd(row.value_low_usd) + ' to ' + fmtUsd(row.value_high_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the value is the fitted line and the category\u2019s peer adjustment, nothing else. The page recomputes this row as ' + fmtUsd(recomputed.implied) + (agrees ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' This is an estimate, not a price.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Launch odds \u2014 separate from the value' }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'Odds from the peers' }), el('b', { class: 'num', text: fmtOdds(row.odds_base) + ' in ' + (row.category || 'Uncategorised') })),
        el('div', null, el('span', { text: 'Odds age factor (' + fmtAge(row.age_days) + ' pre-token)' }), el('b', { class: 'num', text: 'x' + row.odds_age_factor.toFixed(2) })),
        el('div', { class: 'total' }, el('span', { text: 'Launch odds' }), el('b', { class: 'num odds', text: fmtOdds(row.token_odds) }))
      ),
      el('p', { class: 'sub', text: 'The odds answer a different question: how likely a launch is, from the peers\u2019 record, decayed by the time already spent pre-token. They are not multiplied into the value above. The one place they meet the value is the farm scenario below, which weights a launch\u2019s payout by the chance it happens.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Verdict' }),
      el('div', { class: 'verdict', text: verdictFor(row) + ' Suggested position: $' + row.capital_usd + ' (minimum $' + row.min_capital_usd + ').' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('p', { class: 'sub', text: 'Plan economics: about ' + fmtCost(row.farm_cost_usd) + ' of gas over ' + row.farm_hours.toFixed(1) + ' hours of effort. Scenario expected value ' + fmtUsd(row.farm_expected_usd) + ' (' + fmtPerHour(row.farm_value_per_hour_usd) + ') if a launch pays early users 5% of the value at launch, split over 10,000 wallets and weighted by the launch odds: an estimate under that stated scenario, not a promise.' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    if (comps.length > 0) {
      dialog.appendChild(el('section', { class: 'detail-section' },
        el('h3', { text: 'Live-token comps in ' + (row.category || 'this category') }),
        el('div', { class: 'comps' }, comps.map(function (c) {
          return el('div', null, el('span', { text: c.name }), el('b', { class: 'num', text: fmtUsd(c.mcap_usd) + ' (' + c.multiple.toFixed(2) + 'x TVL)' }));
        })),
        el('p', { class: 'sub', text: 'The largest live-token protocols in the category, by market cap. Their multiples are what the peer adjustment is fitted from.' })
      ));
    }
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function footer() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Snapshot: ' + DATA.source + '. "No token" means the record carries no token: a protocol on the board may still have a token its DefiLlama record does not carry. Implied values are the entry\u2019s own model, never a price, and never a prediction of whether or when a token is issued.' }),
      el('p', { text: 'Model ' + DATA.model_version + ': log10(mcap) = ' + DATA.fit.intercept + ' + ' + DATA.fit.slope + ' log10(tvl) + peer adjustment, the value at launch; launch odds from the peers\u2019 record, decayed by a survival curve over age, printed separately and never multiplied into the value; fitted on ' + DATA.fit.n_fit + ' live-token protocols; 5-fold cross-validated median error ' + Math.pow(10, DATA.validation.cv.median_abs_log10).toFixed(1) + 'x on the printed number.' })
    );
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(kpis());
    shell.appendChild(integrity());
    shell.appendChild(controls());
    if (state.tab === 'board') shell.appendChild(boardTable());
    else if (state.tab === 'live') shell.appendChild(liveTable());
    else if (state.tab === 'peers') shell.appendChild(peersTable());
    else shell.appendChild(methodPanel());
    if (state.tab === 'board') shell.appendChild(methodPanel());
    shell.appendChild(footer());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
