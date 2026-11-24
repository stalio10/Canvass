(() => {
  const appKey = 'uaeLeadFinder.v1';
  const toolbar = document.querySelector('.actions');
  if (!toolbar || typeof leads === 'undefined') return;
  const button = document.createElement('button');
  button.className = 'button';
  button.id = 'auditWebsites';
  button.textContent = 'Analyze websites';
  toolbar.insertBefore(button, document.getElementById('importButton'));
  const panel = document.createElement('section');
  panel.className = 'panel';
  panel.id = 'auditProgress';
  panel.style.cssText = 'display:none;margin:0 0 14px';
  panel.innerHTML = '<strong id="auditTitle">Website analysis</strong><div id="auditText" style="margin-top:6px;color:#727b8d;font-size:13px"></div><div style="height:8px;background:#eef1f5;border-radius:8px;margin-top:10px;overflow:hidden"><i id="auditBar" style="display:block;width:0;height:100%;background:#3157e8"></i></div>';
  document.querySelector('.metrics').after(panel);
  let stop = false;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const scoreOf = x => {
    const c = x.lighthouseResult && x.lighthouseResult.categories || {};
    const n = key => c[key] && Number.isFinite(c[key].score) ? Math.round(c[key].score * 100) : null;
    return {performance:n('performance'),seo:n('seo'),accessibility:n('accessibility'),bestPractices:n('best-practices')};
  };
  const grade = s => {
    const scores = [s.performance,s.seo,s.accessibility,s.bestPractices].filter(Number.isFinite);
    if (!scores.length) return 'unknown';
    if (scores.some(v => v < 50)) return 'bad';
    if (scores.length < 4 || scores.some(v => v < 80)) return 'medium';
    return 'good';
  };
  const describeError = e => String(e && e.message || e || 'Audit failed').slice(0,180);
  async function auditOne(lead, apiKey) {
    let target = String(lead.website || '').trim();
    if (!/^https?:\/\//i.test(target)) target = 'https://' + target;
    const parsed = new URL(target);
    if (!['http:','https:'].includes(parsed.protocol)) throw Error('Website URL must use HTTP or HTTPS');
    const url = new URL('https://www.googleapis.com/pagespeedonline/v5/runPagespeed');
    url.searchParams.set('url', parsed.href);
    url.searchParams.set('strategy','mobile');
    ['performance','seo','accessibility','best-practices'].forEach(c => url.searchParams.append('category',c));
    if (apiKey) url.searchParams.set('key',apiKey);
    const response = await fetch(url,{signal:AbortSignal.timeout(90000)});
    const data = await response.json();
    if (!response.ok || !data.lighthouseResult) throw Error('PageSpeed HTTP ' + response.status + ': ' + ((data.error && data.error.message) || 'Audit unavailable'));
    const scores = scoreOf(data);
    const g = grade(scores);
    lead.mobilePerformance = scores.performance;
    lead.seoScore = scores.seo;
    lead.accessibilityScore = scores.accessibility;
    lead.bestPracticesScore = scores.bestPractices;
    lead.grade = g === 'unknown' ? '' : g;
    lead.websiteStatus = g === 'unknown' ? 'candidate' : g;
    lead.analysisStatus = g === 'unknown' ? 'pending' : 'checked';
    lead.auditStatus = 'checked';
    lead.auditError = '';
    lead.auditAt = new Date().toISOString();
    lead.checkedAt = lead.auditAt.slice(0,10);
    const audits = data.lighthouseResult.audits || {};
    lead.mobileUsability = audits['viewport'] && audits['viewport'].score === 1 ? 'Pass' : 'Review';
    lead.httpsStatus = audits['is-on-https'] && audits['is-on-https'].score === 1 ? 'Pass' : 'Review';
    lead.titleStatus = audits['document-title'] && audits['document-title'].score === 1 ? 'Pass' : 'Review';
    lead.metaDescriptionStatus = audits['meta-description'] && audits['meta-description'].score === 1 ? 'Pass' : 'Review';
  }
  button.onclick = async () => {
    if (!leads.length) { alert('Import your website Excel file first.'); return; }
    stop = false;
    const pending = leads.filter(x => x.website && x.auditStatus !== 'checked');
    if (!pending.length) { alert('All websites have already been analyzed. Import more websites or clear the old audit results first.'); return; }
    let apiKey = localStorage.getItem(appKey + '.pagespeedKey') || '';
    const answer = prompt('For a large list, enter your Google PageSpeed API key (recommended). Leave blank to try the limited no-key quota. The key is stored only in this browser.', apiKey);
    if (answer === null) return;
    apiKey = answer.trim();
    if (apiKey) localStorage.setItem(appKey + '.pagespeedKey',apiKey);
    const p = document.getElementById('auditProgress'), text = document.getElementById('auditText'), bar = document.getElementById('auditBar');
    p.style.display = 'block';
    button.disabled = true;
    const stopButton = document.createElement('button');
    stopButton.className = 'button secondary';
    stopButton.textContent = 'Pause after current site';
    stopButton.onclick = () => { stop = true; stopButton.disabled = true; stopButton.textContent = 'Pausing…'; };
    toolbar.insertBefore(stopButton,button);
    let done = 0, failed = 0;
    for (const lead of pending) {
      if (stop) break;
      const current = done + failed + 1;
      text.textContent = 'Checking ' + current + ' of ' + pending.length + ': ' + (lead.name || lead.website) + ' · results save as they finish';
      try { await auditOne(lead,apiKey); done++; }
      catch (e) { lead.auditStatus = 'error'; lead.auditError = describeError(e); lead.auditAt = ''; failed++; if (/PageSpeed HTTP 429|quota|Too Many Requests/i.test(lead.auditError)) stop = true; }
      try { save(); render(); } catch (e) {}
      bar.style.width = Math.round((current / pending.length) * 100) + '%';
      if (!stop && current < pending.length) await wait(1400);
    }
    const paused = stop;
    const quotaHit = leads.some(x => x.auditStatus === 'error' && /PageSpeed HTTP 429|quota|Too Many Requests/i.test(x.auditError || '')); text.textContent = (paused ? 'Paused. ' : 'Finished. ') + done + ' analyzed, ' + failed + ' need retry. ' + (pending.length - done - failed) + ' remain.' + (quotaHit ? ' Google quota limit reached; add an API key or increase quota, then retry.' : '');
    document.getElementById('auditTitle').textContent = 'Website analysis ' + (paused ? 'paused' : 'complete');
    button.disabled = false;
    stopButton.remove();
    if (done || failed) { try { render(); } catch(e) {} }
  };
})();

(() => {
  const originalRows = requestedRows;
  requestedHeaders.push('Mobile Performance','SEO Score','Accessibility Score','Best Practices Score','Mobile Usability','HTTPS','Page Title','Meta Description','Audit Status','Audit Date');
  requestedRows = records => originalRows(records).map((row,i) => {
    const x = records[i];
    return [...row,x.mobilePerformance ?? '',x.seoScore ?? '',x.accessibilityScore ?? '',x.bestPracticesScore ?? '',x.mobileUsability || '',x.httpsStatus || '',x.titleStatus || '',x.metaDescriptionStatus || '',x.auditStatus || 'Not checked',x.auditAt || ''];
  });
  const originalRender = renderRows;
  renderRows = () => {
    originalRender();
    if (tableView !== 'business') return;
    const header = $('tableHead').querySelector('tr');
    if (!header || header.querySelector('[data-audit-header]')) return;
    ['Mobile speed','SEO','Accessibility','Best practices'].forEach(label => {
      const th = document.createElement('th');
      th.textContent = label;
      th.dataset.auditHeader = '1';
      header.appendChild(th);
    });
    $('rows').querySelectorAll('tr').forEach(tr => {
      const company = tr.cells[1]?.textContent || '';
      const link = tr.querySelector('a');
      const href = link?.href || '';
      const x = leads.find(item => item.name === company && item.website && (() => {
        try { return new URL(/^https?:\/\//i.test(item.website) ? item.website : 'https://' + item.website).hostname === new URL(href).hostname; }
        catch(e) { return false; }
      })());
      [x?.mobilePerformance,x?.seoScore,x?.accessibilityScore,x?.bestPracticesScore].forEach(v => {
        const td = document.createElement('td');
        td.textContent = v == null ? (x?.auditStatus === 'error' ? 'Retry' : 'Not checked') : v + '/100';
        tr.appendChild(td);
      });
    });
  };
})();

(() => {
  if (typeof leads === 'undefined' || typeof importUsingUserHeaders !== 'function') return;
  const originalImport = importUsingUserHeaders;
  importUsingUserHeaders = rows => {
    const existing = new Set(leads.map(x => {
      try { return x.website ? new URL(/^https?:\/\//i.test(x.website) ? x.website : 'https://' + x.website).hostname.toLowerCase().replace(/^www\./,'') : ''; }
      catch(e) { return ''; }
    }).filter(Boolean));
    originalImport(rows);
    const seen = new Set();
    let addedUnique = 0;
    leads = leads.filter(x => {
      let domain = '';
      try { domain = x.website ? new URL(/^https?:\/\//i.test(x.website) ? x.website : 'https://' + x.website).hostname.toLowerCase().replace(/^www\./,'') : ''; }
      catch(e) {}
      if (!domain) return true;
      if (seen.has(domain)) return false;
      seen.add(domain);
      if (!existing.has(domain)) addedUnique++;
      return true;
    });
    save();
    render();
    window.__autoAuditImportAdded = addedUnique;
  };
  const previousChange = $('fileInput').onchange;
  $('fileInput').onchange = async event => {
    window.__autoAuditImportAdded = 0;
    window.__auditDataImported = false;
    await previousChange(event);
    if (window.__autoAuditImportAdded > 0 && !window.__auditDataImported) {
      const count = window.__autoAuditImportAdded;
      window.__autoAuditImportAdded = 0;
      alert('Imported ' + count + ' new unique websites. Starting the automatic website and SEO analysis.');
      document.getElementById('auditWebsites').click();
    }
  };
})();


(() => {
  if (typeof leads === 'undefined') return;
  const gradeFilter = $('filter');
  if (gradeFilter && !document.getElementById('businessTypeFilter')) {
    const select = document.createElement('select');
    select.className = 'filter';
    select.id = 'businessTypeFilter';
    select.setAttribute('aria-label','Filter by business type');
    select.innerHTML = '<option value="all">All business types</option><option value="established">Established organizations</option><option value="startup">Startups</option><option value="unclassified">Unclassified</option>';
    gradeFilter.before(select);
  }
  const typeSelector = $('importType');
  if (typeSelector) {
    const baseImport = importUsingUserHeaders;
    importUsingUserHeaders = rows => {
      const prior = new Set(leads.map(x => x.id));
      baseImport(rows);
      const chosen = typeSelector.value;
      if (chosen !== 'auto') leads.filter(x => !prior.has(x.id)).forEach(x => { if (!x.businessType || x.businessType === 'unclassified') x.businessType = chosen; });
      save();
      render();
    };
  }
  const baseRender = render;
  render = () => {
    const selected = $('businessTypeFilter')?.value || 'all';
    if (selected === 'all') return baseRender();
    const allLeads = leads;
    leads = allLeads.filter(x => (x.businessType || 'unclassified') === selected);
    try { baseRender(); } finally { leads = allLeads; }
  };
  $('businessTypeFilter')?.addEventListener('change',() => { page=0; render(); });
  const baseRows = requestedRows;
  requestedHeaders.push('Business Type');
  requestedRows = records => baseRows(records).map((row,i) => [...row,records[i].businessType || 'unclassified']);
  const renderBase = renderRows;
  renderRows = () => {
    renderBase();
    if (tableView !== 'business') return;
    const header = $('tableHead').querySelector('tr');
    if (!header || header.querySelector('[data-business-type-header]')) return;
    const th = document.createElement('th');
    th.textContent = 'Business type';
    th.dataset.businessTypeHeader = '1';
    header.appendChild(th);
    $('rows').querySelectorAll('tr').forEach(tr => {
      const name = tr.cells[1]?.textContent || '';
      const href = tr.querySelector('a')?.href || '';
      let item = leads.find(x => x.name === name && x.website && (() => { try { return new URL(/^https?:\/\//i.test(x.website) ? x.website : 'https://' + x.website).hostname === new URL(href).hostname; } catch(e) { return false; } })());
      if (!item) item = leads.find(x => x.name === name);
      const td = document.createElement('td');
      td.textContent = item?.businessType === 'startup' ? 'Startup' : item?.businessType === 'established' ? 'Established organization' : 'Unclassified';
      tr.appendChild(td);
    });
  };
})();

(() => {
  const oldImport = importUsingUserHeaders;
  importUsingUserHeaders = rows => {
    const header = rows && rows[0] ? rows[0].map(v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g,'')) : [];
    window.__auditDataImported = header.some(h => h === 'auditstatus' || h === 'pagespeedauditstatus');
    return oldImport(rows);
  };
  const oldRows = requestedRows;
  requestedHeaders.push('Basic SEO Score');
  requestedRows = records => oldRows(records).map((row,i) => [...row,records[i].basicSeoScore ?? '']);
  const oldRenderRows = renderRows;
  renderRows = () => {
    oldRenderRows();
    if (tableView !== 'business') return;
    const header = $('tableHead').querySelector('tr');
    if (!header || header.querySelector('[data-basic-seo-header]')) return;
    const th = document.createElement('th');
    th.textContent = 'Basic SEO';
    th.dataset.basicSeoHeader = '1';
    header.appendChild(th);
    $('rows').querySelectorAll('tr').forEach(tr => {
      const name = tr.cells[1]?.textContent || '';
      const href = tr.querySelector('a')?.href || '';
      let item = leads.find(x => x.name === name && x.website && (() => { try { return new URL(/^https?:\/\//i.test(x.website) ? x.website : 'https://' + x.website).hostname === new URL(href).hostname; } catch(e) { return false; } })());
      if (!item) item = leads.find(x => x.name === name);
      const td = document.createElement('td');
      td.textContent = item?.basicSeoScore == null ? '—' : item.basicSeoScore + '/100';
      tr.appendChild(td);
    });
  };
})();

(() => {
  const baseRows = requestedRows;
  const exportFields = ['Website Status Basis','HTTP Status','Final URL','Website Title','Meta Description','Open Graph Title','Mobile Viewport','H1 Count','First H1','Canonical URL','Basic SEO Score Basis'];
  requestedHeaders.push(...exportFields);
  requestedRows = records => baseRows(records).map((row,i) => {
    const x=records[i];
    return [...row,x.websiteStatusBasis||'',x.httpStatus||'',x.finalUrl||'',x.websiteTitle||'',x.metaDescription||'',x.openGraphTitle||'',x.mobileViewport||'',x.h1Count??'',x.firstH1||'',x.canonicalUrl||'',x.basicSeoScoreBasis||''];
  });
  const previousRows = renderRows;
  renderRows = () => {
    previousRows();
    if (tableView !== 'business') return;
    const header=$('tableHead').querySelector('tr');
    if (!header || header.querySelector('[data-site-detail-header]')) return;
    const columns=[
      ['HTTP',x=>x.httpStatus],
      ['Website title',x=>x.websiteTitle],
      ['Meta description',x=>x.metaDescription],
      ['Viewport',x=>x.mobileViewport],
      ['H1s',x=>x.h1Count],
      ['Canonical URL',x=>x.canonicalUrl]
    ];
    columns.forEach(([label])=>{const th=document.createElement('th');th.textContent=label;th.dataset.siteDetailHeader='1';header.appendChild(th)});
    $('rows').querySelectorAll('tr').forEach(tr=>{
      const name=tr.cells[1]?.textContent||'', href=tr.querySelector('a')?.href||'';
      let x=leads.find(item=>item.name===name&&item.website&&(()=>{try{return new URL(/^https?:\/\//i.test(item.website)?item.website:'https://'+item.website).hostname===new URL(href).hostname}catch(e){return false}})());
      if(!x)x=leads.find(item=>item.name===name);
      columns.forEach(([,get])=>{const td=document.createElement('td');const value=x?get(x):'';td.title=value==null?'':String(value);td.textContent=value==null||value===''?'—':String(value).length>90?String(value).slice(0,87)+'…':String(value);tr.appendChild(td)});
    });
  };
})();

(() => {
  const style=document.createElement('style');
  style.textContent=".gradeBadge{display:inline-block;border-radius:20px;padding:6px 10px;font-size:12px;font-weight:700;white-space:nowrap}.gradeBadge.good{background:#e7f5ef;color:#08775c}.gradeBadge.medium{background:#fff2df;color:#9b6200}.gradeBadge.bad{background:#ffebed;color:#ae3540}.gradeBadge.unknown{background:#eff1f5;color:#697385}";
  document.head.appendChild(style);
})();
