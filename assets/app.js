(() => {
  const $ = id => document.getElementById(id);
  const EMAIL = 'yisroel@q8marketing.design';
  const PAGE = 30;
  const DAY = 864e5;
  let all = [], shown = PAGE, meta = {}, imported = [];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function formatOffset(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})?$/);
    if (!m) return iso || '';
    let hour = +m[4];
    const ampm = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    const tz = !m[7] ? '' : m[7] === 'Z' ? 'UTC' : m[7];
    return `${months[+m[2] - 1]} ${+m[3]}, ${m[1]}, ${hour}:${m[5]} ${ampm}${tz ? ' (' + tz + ')' : ''}`;
  }

  function asET(iso) {
    const d = new Date(iso);
    if (!iso || Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('en-US', {timeZone:'America/New_York', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit'}) + ' ET';
  }

  function daysLeft(iso) {
    const t = new Date(iso).getTime();
    if (!iso || Number.isNaN(t)) return Infinity;
    return (t - Date.now()) / DAY;
  }

  function deadlineText(b) {
    const feed = (b.deadline && b.deadline.feed) || {};
    if (feed.raw && feed.source === 'rss') return esc(feed.raw);
    if (b.due) return esc(formatOffset(b.due));
    if (b.dueRaw) return esc(b.dueRaw);
    return 'Deadline not in the feed';
  }

  function mailto(b) {
    const feed = (b.deadline && b.deadline.feed) || {};
    const subject = `Draft response: ${b.title} (${b.solicitation || b.canonicalId || b.id})`;
    const body = [
      'Please draft a response for this opportunity. Confirm the deadline on the official notice.', '',
      `Title: ${b.title}`,
      `Solicitation #: ${b.solicitation || b.canonicalId || 'n/a'}`,
      `Agency: ${b.agency}${b.subTier && b.subTier !== b.agency ? ' / ' + b.subTier : ''}`,
      `Source: ${b.sourceName || b.source || 'n/a'}`,
      `Notice type: ${b.type || 'n/a'}`,
      `NAICS: ${b.naics || 'n/a'}${b.naicsLabel ? ' (' + b.naicsLabel + ')' : ''}`,
      `Categories: ${(b.categories || []).join(', ') || 'n/a'}`,
      `Set-aside: ${b.setAside || 'n/a'}`,
      `Deadline as stored: ${feed.raw || b.dueRaw || b.due || 'n/a'}`,
      b.deadline && b.deadline.conflictNote ? `Deadline note: ${b.deadline.conflictNote}` : '',
      `Place: ${b.place || 'n/a'}`,
      `Official notice: ${b.link}`,
      '', 'Summary:', b.summary || ''
    ].filter(line => line !== '').join('\n');
    return `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function fill(sel, values, label = v => v) {
    for (const v of values) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label(v);
      sel.appendChild(o);
    }
  }

  function filtered() {
    const q = $('q').value.trim().toLowerCase();
    const n = $('naics').value, a = $('agency').value, due = $('due').value;
    const sa = $('setaside').value, f = $('featured').checked;
    const category = $('category').value, source = $('source').value, jurisdiction = $('jurisdiction').value;
    const terms = q.split(/\s+/).filter(Boolean);
    return all.filter(b => {
      if (f && !b.featured) return false;
      if (n && b.naics !== n) return false;
      if (a && b.agency !== a) return false;
      if (source && b.source !== source) return false;
      if (jurisdiction && b.jurisdiction !== jurisdiction) return false;
      if (category && !(b.categories || []).includes(category)) return false;
      if (sa === '__any' ? b.setAside === 'None' : sa && b.setAside !== sa) return false;
      if (due) {
        const d = daysLeft(b.due);
        if (due === '31+' ? d <= 30 : d > +due) return false;
      }
      if (terms.length) {
        const hay = [b.title, b.agency, b.subTier, b.office, b.summary, b.solicitation, b.canonicalId, b.naics, b.sourceName, (b.categories || []).join(' ')].join(' ').toLowerCase();
        if (!terms.every(t => hay.includes(t))) return false;
      }
      return true;
    });
  }

  function card(b, extraClass) {
    const d = daysLeft(b.due);
    const cls = !Number.isFinite(d) ? 'ok' : d < 3 ? 'soon' : d < 10 ? 'mid' : 'ok';
    const left = !Number.isFinite(d) ? 'deadline needs a check' : d < 1 ? 'due within 24h' : `${Math.floor(d)} days left`;
    const feed = (b.deadline && b.deadline.feed) || {};
    const et = b.due ? asET(b.due) : '';
    const showEt = et && feed.offset && feed.offset !== '-05:00' && feed.offset !== '-04:00' && feed.timezone !== 'America/New_York';
    const cats = (b.categories || []).map(c => `<span class="pill">${esc(c)}</span>`).join('');
    const addenda = (b.addenda || []).slice(0, 4).map(item =>
      `<li>${esc(item.posted || 'undated')} · ${esc(item.type || 'notice')} · ${item.link ? `<a href="${esc(item.link)}" target="_blank" rel="noopener">${esc(item.noticeId || 'notice')}</a>` : esc(item.noticeId || 'notice')} · ${esc(item.note || '')}</li>`
    ).join('');
    return `<article class="bid ${extraClass || ''}">
      <div>
        <h3><a href="${esc(b.link)}" target="_blank" rel="noopener">${esc(b.title)}</a></h3>
        <div class="sub">${esc(b.agency || 'Agency not in the feed')}${b.subTier && b.subTier !== b.agency ? ' · ' + esc(b.subTier) : ''}${b.place ? ' · ' + esc(b.place) : ''}</div>
        ${b.summary ? `<p class="sum">${esc(b.summary)}</p>` : ''}
        ${b.deadline && b.deadline.conflict ? `<p class="conflict">${esc(b.deadline.conflictNote || 'The feed deadline conflicts with another notice. Confirm it on the official page.')}</p>` : ''}
        ${b.dueAssumption ? `<p class="assume">${esc(b.dueAssumption)}</p>` : ''}
        <div class="pills">
          <span class="pill">${esc(b.sourceName || b.source || 'source')}</span>
          ${b.jurisdiction ? `<span class="pill">${esc(b.jurisdiction)}</span>` : ''}
          ${b.naics ? `<span class="pill ${b.featured ? 'f' : ''}">NAICS ${esc(b.naics)}${b.naicsLabel ? ' · ' + esc(b.naicsLabel) : ''}</span>` : ''}
          ${cats}
          ${b.type ? `<span class="pill">${esc(b.type)}</span>` : ''}
          ${b.setAside && b.setAside !== 'None' ? `<span class="pill sa">${esc(String(b.setAside).replace(/\s*\(FAR [^)]*\)/, ''))}</span>` : ''}
          <span class="pill">#${esc(b.canonicalId || b.solicitation || b.id)}</span>
        </div>
        ${addenda ? `<details class="addenda"><summary>${b.addenda.length} related notice${b.addenda.length === 1 ? '' : 's'} / addenda</summary><ul>${addenda}</ul></details>` : ''}
        <p class="prov">Retrieved ${esc((b.provenance && b.provenance.retrievedAt) || '—')} · record ${esc((b.provenance && b.provenance.recordId) || b.id)}${b.provenance && b.provenance.stale ? ' · previous copy, source refresh failed' : ''}</p>
      </div>
      <div class="side">
        <div class="due ${cls}">${deadlineText(b)}</div>
        ${showEt ? `<div class="muted small">${esc(et)}</div>` : ''}
        <div class="muted small">${left}</div>
        <a class="btn ghost" href="${esc(b.link)}" target="_blank" rel="noopener">Official notice</a>
        ${extraClass === 'demo-card' ? '' : `<a class="btn" href="${esc(mailto(b))}">Draft a response</a>`}
      </div>
    </article>`;
  }

  function render() {
    const rows = filtered();
    $('count').textContent = `${rows.length.toLocaleString()} matching live opportunit${rows.length === 1 ? 'y' : 'ies'}`;
    const list = $('list');
    if (!rows.length) {
      list.innerHTML = '<div class="empty">No open bids match these filters. The source list shows what this build actually reads.</div>';
      $('more').hidden = true;
      return;
    }
    list.innerHTML = rows.slice(0, shown).map(b => card(b)).join('');
    $('more').hidden = rows.length <= shown;
  }

  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    if (/[",\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function exportCsv() {
    const cols = ['id','canonicalId','solicitation','title','agency','jurisdiction','source','categories','posted','due','dueRaw','dueTimezone','type','naics','setAside','place','link'];
    const lines = [cols.join(',')];
    filtered().forEach(row => {
      lines.push(cols.map(col => csvCell(Array.isArray(row[col]) ? row[col].join('|') : row[col])).join(','));
    });
    const blob = new Blob([lines.join('\n')], {type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'q8-bid-finder-filtered.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = '', quoted = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else quoted = false;
        } else cell += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch !== '\r') cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    if (!rows.length) return [];
    const header = rows.shift().map(h => h.trim());
    return rows.filter(r => r.some(Boolean)).map(r => {
      const obj = {};
      header.forEach((key, idx) => { obj[key] = r[idx] || ''; });
      return obj;
    });
  }

  function renderImported() {
    const wrap = $('imported-wrap');
    wrap.hidden = imported.length === 0;
    $('imported').innerHTML = imported.map(b => card(b, 'imported-card')).join('');
  }

  function statusClass(status) {
    return String(status || '').replace(/[^a-z-]/g, '') || 'manual';
  }

  function renderSources(doc) {
    const rows = (doc && doc.sources) || [];
    $('stat-sources').textContent = rows.filter(s => s.status === 'working').length.toLocaleString();
    $('source-grid').innerHTML = rows.map(s => `<article class="card source">
      <div class="source-top"><h3>${esc(s.name)}</h3><span class="status ${statusClass(s.status)}">${esc(s.status)}</span></div>
      <p>${esc(s.coverage || '')}</p>
      <p class="small">${esc(s.message || s.notes || '')}</p>
      <p class="small muted">In this list: ${Number(s.opportunities || 0).toLocaleString()} · scanned ${s.scanned ?? '—'} · matched ${s.matched ?? '—'} · last success ${esc(s.lastSuccess || '—')}</p>
      ${s.error ? `<p class="conflict">${esc(s.error)}</p>` : ''}
      ${s.feedUrl ? `<p class="small"><a href="${esc(s.feedUrl)}" target="_blank" rel="noopener">Feed or publisher page</a></p>` : ''}
    </article>`).join('') || '<div class="empty">Source status has not been written yet. Run <code>python3 scripts/fetch_bids.py</code>.</div>';
    if (doc && doc.coverageNote) $('coverage').textContent = doc.coverageNote + ' Demo fixtures are not included in the counts.';
  }

  function renderRuns(doc) {
    const runs = (doc && doc.runs) || [];
    $('runs').innerHTML = runs.length ? runs.slice(0, 8).map(run => `<article class="run">
      <strong>${esc(run.status)}</strong>
      <span>${esc(run.startedAt)} → ${esc(run.finishedAt)}</span>
      <span>${Number(run.opportunityCount || 0).toLocaleString()} opportunities · deduped ${Number((run.dedup || {}).clustersMerged || 0).toLocaleString()} clusters</span>
      ${run.notes ? `<span class="muted">${esc(run.notes)}</span>` : ''}
      ${(run.sources || []).map(s => `<span class="pill">${esc(s.id)} · ${esc(s.status)}</span>`).join(' ')}
    </article>`).join('') : '<p class="muted">No run history yet.</p>';
  }

  async function init() {
    $('yr').textContent = new Date().getFullYear();
    $('export').addEventListener('click', exportCsv);
    $('import').addEventListener('change', () => {
      const file = $('import').files && $('import').files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        imported = parseCsv(String(reader.result || '')).filter(row => row.title).map((row, idx) => ({
          id: 'import-' + (idx + 1),
          title: row.title,
          agency: row.agency || 'Imported row',
          solicitation: row.solicitation || '',
          canonicalId: row.canonicalId || row.solicitation || '',
          link: row.link || '#imported',
          due: row.due || '',
          dueRaw: row.dueRaw || row.due || '',
          summary: row.summary || '',
          source: 'imported',
          sourceName: 'Imported CSV',
          jurisdiction: row.jurisdiction || '',
          categories: row.categories ? String(row.categories).split('|') : [],
          featured: false,
          setAside: 'None',
          type: 'Imported',
          demo: false,
          deadline: {feed:{raw: row.dueRaw || '', source:'csv', pdfParsed:false}, conflict:false, conflictNote:''},
          provenance: {retrievedAt: 'this browser', recordId: 'import-' + (idx + 1)}
        }));
        renderImported();
      };
      reader.readAsText(file);
    });
    let data;
    try {
      const res = await fetch('data/bids.json', {cache:'no-cache'});
      data = await res.json();
      meta = data.meta || {};
      all = (data.bids || []).filter(b => !b.demo && (!b.due || new Date(b.due) > Date.now() || (b.deadline && b.deadline.feed && b.deadline.feed.precision === 'unknown')));
    } catch (e) {
      $('meta').textContent = 'Could not load live bids right now.';
      return;
    }
    $('stat-count').textContent = all.length.toLocaleString();
    $('stat-featured').textContent = all.filter(b => b.featured).length.toLocaleString();
    $('stat-week').textContent = all.filter(b => daysLeft(b.due) <= 7).length.toLocaleString();
    const updated = meta.updated ? new Date(meta.updated).toLocaleString('en-US', {dateStyle:'medium', timeStyle:'short', timeZone:'America/New_York'}) + ' ET' : 'unknown';
    $('meta').textContent = `Live file updated ${updated}. ${meta.coverageNote || ''}`;
    if (meta.coverageNote) $('coverage').textContent = meta.coverageNote + ' Demo fixtures are not included in the counts.';
    const labels = {};
    (meta.categories || []).forEach(c => { labels[c.id] = c.label; });
    const presentCats = [...new Set(all.flatMap(b => b.categories || []))];
    fill($('category'), presentCats, v => labels[v] || v);
    const fn = meta.featuredNaics || {};
    const naicsSet = [...new Set(all.map(b => b.naics).filter(Boolean))].sort((x, y) => (fn[y] ? 1 : 0) - (fn[x] ? 1 : 0) || x.localeCompare(y));
    fill($('naics'), naicsSet, v => v + (fn[v] ? ' · ' + fn[v] : ''));
    fill($('agency'), [...new Set(all.map(b => b.agency).filter(Boolean))].sort());
    fill($('source'), [...new Set(all.map(b => b.source).filter(Boolean))].sort(), v => {
      const sample = all.find(b => b.source === v);
      return sample && sample.sourceName ? sample.sourceName : v;
    });
    fill($('jurisdiction'), [...new Set(all.map(b => b.jurisdiction).filter(Boolean))].sort());
    const sa = [...new Set(all.map(b => b.setAside))].filter(v => v && v !== 'None').sort();
    const any = document.createElement('option');
    any.value = '__any';
    any.textContent = 'Any small-business set-aside';
    $('setaside').appendChild(any);
    fill($('setaside'), sa, v => v.replace(/\s*\(FAR [^)]*\)/, ''));
    ['q','naics','agency','due','setaside','featured','category','source','jurisdiction'].forEach(id => $(id).addEventListener('input', () => { shown = PAGE; render(); }));
    $('more').addEventListener('click', () => { shown += PAGE; render(); });
    render();
    try {
      const src = await fetch('data/sources.json', {cache:'no-cache'});
      renderSources(await src.json());
    } catch (e) { renderSources(null); }
    try {
      const runs = await fetch('data/runs.json', {cache:'no-cache'});
      renderRuns(await runs.json());
    } catch (e) { renderRuns(null); }
    try {
      const demo = await fetch('data/demo/opportunities.json', {cache:'no-cache'});
      const demoDoc = await demo.json();
      $('demo-list').innerHTML = (demoDoc.bids || []).map(b => card(b, 'demo-card')).join('');
    } catch (e) {
      $('demo-list').innerHTML = '<div class="empty">Demo fixtures could not be loaded.</div>';
    }
  }
  init();
})();
