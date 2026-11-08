(() => {
  const $ = id => document.getElementById(id);
  const EMAIL = 'yisroel@q8marketing.design';
  const PAGE = 30;
  let all = [], shown = PAGE, meta = {};
  const DAY = 864e5;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmtDue = iso => {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', timeZone:'America/New_York'}) + ' ET';
  };
  const daysLeft = iso => (new Date(iso) - Date.now()) / DAY;

  function mailto(b) {
    const subject = `Draft response: ${b.title} (${b.solicitation || b.id})`;
    const body = [
      'Please draft a response for this opportunity:', '',
      `Title: ${b.title}`, `Solicitation #: ${b.solicitation || 'n/a'}`, `Agency: ${b.agency}${b.subTier && b.subTier !== b.agency ? ' / ' + b.subTier : ''}`,
      `Office: ${b.office || 'n/a'}`, `Notice type: ${b.type}`, `NAICS: ${b.naics}${b.naicsLabel ? ' (' + b.naicsLabel + ')' : ''}`,
      `Set-aside: ${b.setAside}`, `Due: ${fmtDue(b.due)}`, `Place of performance: ${b.place || 'n/a'}`,
      `Contracting contact: ${b.contact || 'n/a'}`, `Official notice: ${b.link}`, '', 'Summary:', b.summary || ''
    ].join('\n');
    return `mailto:${EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function fill(sel, values, label = v => v) {
    for (const v of values) { const o = document.createElement('option'); o.value = v; o.textContent = label(v); sel.appendChild(o); }
  }

  function filtered() {
    const q = $('q').value.trim().toLowerCase(), n = $('naics').value, a = $('agency').value,
          due = $('due').value, sa = $('setaside').value, f = $('featured').checked;
    const terms = q.split(/\s+/).filter(Boolean);
    return all.filter(b => {
      if (f && !b.featured) return false;
      if (n && b.naics !== n) return false;
      if (a && b.agency !== a) return false;
      if (sa === '__any' ? b.setAside === 'None' : sa && b.setAside !== sa) return false;
      if (due) { const d = daysLeft(b.due); if (due === '31+' ? d <= 30 : d > +due) return false; }
      if (terms.length) { const hay = (b.title + ' ' + b.agency + ' ' + b.subTier + ' ' + b.office + ' ' + b.summary + ' ' + b.solicitation + ' ' + b.naics).toLowerCase(); if (!terms.every(t => hay.includes(t))) return false; }
      return true;
    });
  }

  function render() {
    const rows = filtered();
    $('count').textContent = `${rows.length.toLocaleString()} matching bid${rows.length === 1 ? '' : 's'}`;
    const list = $('list');
    if (!rows.length) { list.innerHTML = '<div class="empty">No open bids match these filters. Try widening your search.</div>'; $('more').hidden = true; return; }
    list.innerHTML = rows.slice(0, shown).map(b => {
      const d = daysLeft(b.due), cls = d < 3 ? 'soon' : d < 10 ? 'mid' : 'ok';
      const left = d < 1 ? 'due within 24h' : `${Math.floor(d)} days left`;
      return `<article class="bid">
        <div>
          <h3><a href="${esc(b.link)}" target="_blank" rel="noopener">${esc(b.title)}</a></h3>
          <div class="sub">${esc(b.agency)}${b.subTier && b.subTier !== b.agency ? ' · ' + esc(b.subTier) : ''}${b.place ? ' · ' + esc(b.place) : ''}</div>
          ${b.summary ? `<p class="sum">${esc(b.summary)}</p>` : ''}
          <div class="pills">
            <span class="pill ${b.featured ? 'f' : ''}">NAICS ${esc(b.naics)}${b.naicsLabel ? ' · ' + esc(b.naicsLabel) : ''}</span>
            <span class="pill">${esc(b.type)}</span>
            ${b.setAside !== 'None' ? `<span class="pill sa">${esc(b.setAside.replace(/\s*\(FAR [^)]*\)/, ''))}</span>` : ''}
            ${b.solicitation ? `<span class="pill">#${esc(b.solicitation)}</span>` : ''}
          </div>
        </div>
        <div class="side">
          <div class="due ${cls}">Due ${esc(fmtDue(b.due))}</div>
          <div class="muted small">${left}</div>
          <a class="btn ghost" href="${esc(b.link)}" target="_blank" rel="noopener">Official notice ↗</a>
          <a class="btn" href="${esc(mailto(b))}">Draft a response</a>
        </div>
      </article>`;
    }).join('');
    $('more').hidden = rows.length <= shown;
  }

  async function init() {
    $('yr').textContent = new Date().getFullYear();
    try {
      const res = await fetch('data/bids.json', {cache: 'no-cache'});
      const data = await res.json();
      meta = data.meta; all = data.bids.filter(b => new Date(b.due) > Date.now());
    } catch (e) { $('meta').textContent = 'Could not load bids right now.'; return; }
    $('stat-count').textContent = all.length.toLocaleString();
    $('stat-featured').textContent = all.filter(b => b.featured).length.toLocaleString();
    $('stat-week').textContent = all.filter(b => daysLeft(b.due) <= 7).length.toLocaleString();
    $('meta').innerHTML = `Source: <a href="${esc(meta.sourceUrl)}" target="_blank" rel="noopener">SAM.gov public data</a> · updated ${new Date(meta.updated).toLocaleString('en-US', {dateStyle:'medium', timeStyle:'short', timeZone:'America/New_York'})} ET`;
    const fn = meta.featuredNaics || {};
    const naicsSet = [...new Set(all.map(b => b.naics))].sort((x, y) => (fn[y] ? 1 : 0) - (fn[x] ? 1 : 0) || x.localeCompare(y));
    fill($('naics'), naicsSet, v => v + (fn[v] ? ' · ' + fn[v] : ''));
    fill($('agency'), [...new Set(all.map(b => b.agency).filter(Boolean))].sort());
    const sa = [...new Set(all.map(b => b.setAside))].filter(v => v !== 'None').sort();
    const any = document.createElement('option'); any.value = '__any'; any.textContent = 'Any small-business set-aside'; $('setaside').appendChild(any);
    fill($('setaside'), sa, v => v.replace(/\s*\(FAR [^)]*\)/, ''));
    ['q', 'naics', 'agency', 'due', 'setaside', 'featured'].forEach(id => $(id).addEventListener('input', () => { shown = PAGE; render(); }));
    $('more').addEventListener('click', () => { shown += PAGE; render(); });
    render();
  }
  init();
})();
