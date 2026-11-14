/* Token Radar dashboard: renders window.RADAR (written by main.ts) with no
   network. Board is sortable and filterable; clicking a row opens its detail
   view with the model breakdown and farm plan. URL params (?detail=slug,
   ?category=, ?chain=, ?q=, ?minTvl=, ?sort=) set the same state, so any view
   is a plain link. */
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D || !D.rows) {
    document.getElementById('rows').innerHTML =
      '<tr><td colspan="8">No radar data loaded.</td></tr>';
    return;
  }

  var params = new URLSearchParams(location.search);
  var state = {
    q: params.get('q') || '',
    cat: params.get('category') || '',
    chain: params.get('chain') || '',
    minTvl: Number(params.get('minTvl') || 0) || 0,
    sort: params.get('sort') || 'rank',
    detail: params.get('detail') || null,
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n == null) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n > 0 ? 'up' : n < 0 ? 'down' : '') + '">' + s + '</span>';
  }
  function ageText(n) {
    if (n == null) return '—';
    if (n >= 365) return (n / 365).toFixed(1) + ' yrs';
    return n + ' days';
  }
  function bySlug(slug) {
    for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === slug) return D.rows[i];
    return null;
  }

  /* Header stats and model constants. */
  document.getElementById('asOf').textContent = D.as_of;
  document.getElementById('statRows').textContent = D.board_size;
  document.getElementById('statWatch').textContent = D.watchlist_size + ' / ' + D.watchlist_size;
  document.getElementById('statEarly').textContent = D.early_size;
  document.getElementById('statTop').textContent = money(D.rows[0].implied_value_usd);
  document.getElementById('statLive').textContent = D.live_size;
  document.getElementById('srcNote').textContent = D.source;
  document.getElementById('mBase').textContent = D.model.base_multiple;
  document.getElementById('mGrowth').textContent =
    D.model.growth_floor + '% … +' + D.model.growth_cap + '%';
  document.getElementById('mWeight').textContent = D.model.growth_weight;
  document.getElementById('mMat').textContent = D.model.maturity_floor;

  /* Filter option lists, built from the data itself. */
  function fillSelect(id, values) {
    var el = document.getElementById(id);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      el.appendChild(o);
    });
  }
  var cats = {}, chains = {};
  D.rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  fillSelect('cat', Object.keys(cats).sort());
  fillSelect('chain', Object.keys(chains).sort());

  var qEl = document.getElementById('q');
  var catEl = document.getElementById('cat');
  var chainEl = document.getElementById('chain');
  var minEl = document.getElementById('minTvl');
  var sortEl = document.getElementById('sort');
  qEl.value = state.q; catEl.value = state.cat; chainEl.value = state.chain;
  minEl.value = String(state.minTvl); sortEl.value = state.sort;

  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    value: function (a, b) { return b.implied_value_usd - a.implied_value_usd || a.rank - b.rank; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd || a.rank - b.rank; },
    growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0) || a.rank - b.rank; },
    age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0) || a.rank - b.rank; },
  };

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (q && (r.name + ' ' + r.slug).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    rows.sort(SORTS[state.sort] || SORTS.rank);
    return rows;
  }

  function renderBoard() {
    var rows = filtered();
    var html = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="rank">#' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + '</span></td>' +
        '<td><span class="pill">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td>' + esc(r.chains.slice(0, 2).join(', ')) + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num val">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
    document.getElementById('rows').innerHTML = html ||
      '<tr><td colspan="8">No protocols match these filters.</td></tr>';
    document.getElementById('count').textContent =
      rows.length + ' of ' + D.rows.length + ' protocols';
  }

  function renderDetail() {
    var box = document.getElementById('detail');
    var r = state.detail ? bySlug(state.detail) : null;
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var m = r.model;
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    box.hidden = false;
    box.innerHTML =
      '<h2>#' + r.rank + ' — ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' · ' + esc(r.category || 'Uncategorised') + ' · ' +
      esc(r.chains.join(', ')) + ' · records no token in this snapshot</p>' +
      '<dl class="facts">' +
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd>' + pct(r.change_7d) + '</dd></div>' +
      '<div><dt>Listed</dt><dd>' + esc(r.listed_at || 'unknown') + ' (' + ageText(r.age_days) + ')</dd></div>' +
      '</dl>' +
      '<h3>Model breakdown — radar-2</h3>' +
      '<ul class="breakdown">' +
      '<li><span>Base — TVL × ' + D.model.base_multiple + '</span><b>' + money(m.base_usd) + '</b></li>' +
      '<li><span>Growth — 7-day change ' + (r.change_7d == null ? 'unreported' : r.change_7d.toFixed(2) + '%') +
      ' clamped to ' + m.growth_pct.toFixed(2) + '%</span><b>× ' + m.growth_multiplier + '</b></li>' +
      '<li><span>Maturity — ' + (r.age_days == null ? 'unknown age' : r.age_days + ' days listed') + '</span><b>× ' + m.maturity_multiplier + '</b></li>' +
      '<li><span>Breadth — ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + '</span><b>× ' + m.breadth_multiplier + '</b></li>' +
      '<li><span>Category factor — ' + esc(r.category || 'uncategorised') + '</span><b>× ' + m.category_factor + '</b></li>' +
      '<li><span>Implied value</span><b>' + money(r.implied_value_usd) + '</b></li>' +
      '</ul>' +
      '<h3>Farm plan — six steps</h3><ol class="steps">' + steps + '</ol>';
    box.scrollIntoView({ block: 'nearest' });
  }

  function renderLive() {
    document.getElementById('liveRows').innerHTML = D.live.map(function (p) {
      return '<tr><td class="name"><b>' + esc(p.name) + '</b><span>' + esc(p.slug) + '</span></td>' +
        '<td><span class="pill">' + esc(p.category || 'Uncategorised') + '</span></td>' +
        '<td>' + esc(p.chains.slice(0, 2).join(', ')) + (p.chains.length > 2 ? ' +' + (p.chains.length - 2) : '') + '</td>' +
        '<td class="num">' + money(p.tvl_usd) + '</td>' +
        '<td class="num val">' + money(p.mcap_usd) + '</td>' +
        '<td class="num">' + pct(p.change_7d) + '</td></tr>';
    }).join('');
  }

  function syncUrl() {
    var p = new URLSearchParams();
    if (state.q) p.set('q', state.q);
    if (state.cat) p.set('category', state.cat);
    if (state.chain) p.set('chain', state.chain);
    if (state.minTvl) p.set('minTvl', String(state.minTvl));
    if (state.sort !== 'rank') p.set('sort', state.sort);
    if (state.detail) p.set('detail', state.detail);
    var s = p.toString();
    history.replaceState(null, '', s ? '?' + s : location.pathname);
  }

  function refresh() { renderBoard(); renderDetail(); syncUrl(); }

  qEl.addEventListener('input', function () { state.q = qEl.value; renderBoard(); syncUrl(); });
  catEl.addEventListener('change', function () { state.cat = catEl.value; refresh(); });
  chainEl.addEventListener('change', function () { state.chain = chainEl.value; refresh(); });
  minEl.addEventListener('change', function () { state.minTvl = Number(minEl.value); refresh(); });
  sortEl.addEventListener('change', function () { state.sort = sortEl.value; refresh(); });
  document.getElementById('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    state.detail = state.detail === tr.dataset.slug ? null : tr.dataset.slug;
    refresh();
  });
  document.querySelectorAll('#board th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.dataset.k;
      state.sort = k === 'rank' ? 'rank' : k === 'name' ? 'rank' : k;
      sortEl.value = state.sort;
      refresh();
    });
  });

  renderBoard();
  renderDetail();
  renderLive();
  syncUrl();
})();
