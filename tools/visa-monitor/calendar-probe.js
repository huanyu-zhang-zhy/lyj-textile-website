/* Local DOM observer only. No network, clicks, forms, credentials or storage APIs.
 * Browser: paste this entire reviewed file into DevTools Console on the booking page.
 * Node: require('./calendar-probe.js') for offline analysis and tests.
 */
(function (root) {
  'use strict';
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Za-z]+) (\d{1,2}) - (.+)$/;

  function capture(doc, href) {
    const DAY = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([A-Za-z]+) (\d{1,2}) - (.+)$/;
    const visible = el => {
      if (el.closest('[aria-hidden="true"], [hidden], [inert]')) return false;
      if (!el.getClientRects().length) return false;
      for (let p = el; p; p = p.parentElement) {
        const s = doc.defaultView.getComputedStyle(p);
        if (s.display === 'none' || s.visibility === 'hidden' || s.visibility === 'collapse') return false;
      }
      return true;
    };
    // No input values, cookies, account details, full HTML or request data are read.
    const body = doc.body?.innerText || '';
    const zone = doc.querySelector('#timezone-field');
    return {
      url: href,
      observedAt: new Date().toISOString(),
      heading: Array.from(doc.querySelectorAll('h1')).filter(visible).map(e => e.textContent.trim()).join(' '),
      months: [...new Set(Array.from(doc.querySelectorAll('div')).filter(visible)
        .map(e => e.textContent.trim())
        .filter(t => /^(?:January|February|March|April|May|June|July|August|September|October|November|December) 20\d{2}$/.test(t)))],
      timezone: zone ? zone.textContent.replace(/\([^)]*\)/g, '').trim() : '',
      blocked: /verify (?:you are|you're) human|access denied|too many requests|security verification/i.test(body),
      days: Array.from(doc.querySelectorAll('button[aria-label]')).filter(visible)
        .map(e => ({ label: e.getAttribute('aria-label'), disabled: e.disabled || e.getAttribute('aria-disabled') === 'true' }))
        .filter(e => DAY.test(e.label)),
    };
  }

  function analyze(raw, expectedMonth) {
    const unknown = reason => ({ status: 'unknown', reason, month: expectedMonth, availableDates: [] });
    if (!/^20\d{2}-(0[1-9]|1[0-2])$/.test(expectedMonth || '')) return unknown('Invalid expected month');
    let url;
    try { url = new URL(raw.url); } catch { return unknown('Invalid page URL'); }
    if (url.origin !== 'https://calendly.com' || url.pathname !== '/conmel-mofa/visa') return unknown('Wrong booking page');
    if (raw.blocked) return { ...unknown('Verification or access restriction detected'), status: 'blocked' };
    if (raw.heading !== 'Visa Application Lodgement') return unknown('Unexpected page heading');
    if (raw.timezone !== 'Sydney, Melbourne Time') return unknown('Unexpected or missing timezone');
    const [year, month] = expectedMonth.split('-').map(Number);
    const monthName = MONTHS[month - 1];
    if (!Array.isArray(raw.months) || raw.months.length !== 1 || raw.months[0] !== `${monthName} ${year}`) return unknown('Displayed month is ambiguous or different');
    if (url.searchParams.get('month') !== expectedMonth) return unknown('URL month differs from expected month');
    const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (!Array.isArray(raw.days) || raw.days.length !== count) return unknown('Incomplete calendar or changed page structure');
    const seen = new Set(), availableDates = [];
    for (const row of raw.days) {
      const m = DAY.exec(row.label || '');
      if (!m || m[2] !== monthName) return unknown('Unexpected date label');
      const day = Number(m[3]);
      if (day < 1 || day > count || seen.has(day) || typeof row.disabled !== 'boolean') return unknown('Invalid or duplicate date');
      seen.add(day);
      const unavailable = /^No times available$/i.test(m[4]);
      const available = /^(?:\d+\s+)?times? available$/i.test(m[4]);
      if (row.disabled && unavailable) continue;
      // Positive labels have not yet been observed live; unfamiliar labels fail closed.
      if (!row.disabled && available) availableDates.push(`${expectedMonth}-${String(day).padStart(2, '0')}`);
      else return unknown('Unrecognized or inconsistent availability label');
    }
    return { status: availableDates.length ? 'available_dates' : 'no_available_dates', month: expectedMonth, availableDates, dateCount: count };
  }

  function compare(previous, current) {
    const valid = x => x && ['available_dates','no_available_dates'].includes(x.status);
    if (!valid(previous) || !valid(current) || previous.month !== current.month) return { comparable: false, addedDates: [], removedDates: [] };
    return { comparable: true,
      addedDates: current.availableDates.filter(d => !previous.availableDates.includes(d)),
      removedDates: previous.availableDates.filter(d => !current.availableDates.includes(d)) };
  }

  const core = { capture, analyze, compare };
  if (typeof module !== 'undefined' && module.exports) { module.exports = core; return; }
  if (!root.document) return;
  root.visaCalendarProbe?.stop?.();
  let timer = null, ticks = 0, expectedMonth = new URL(root.location.href).searchParams.get('month');
  const history = [];
  function stop() { if (timer !== null) root.clearInterval(timer); timer = null; }
  function sample() {
    const raw = capture(root.document, root.location.href);
    const result = analyze(raw, expectedMonth);
    const entry = { observedAt: raw.observedAt, timezone: raw.timezone, ...result,
      change: compare(history.at(-1), result) };
    history.push(entry);
    if (history.length > 120) history.shift();
    console.log('[visa-calendar-probe]', entry);
    if (['unknown','blocked','available_dates'].includes(result.status)) stop();
    return entry;
  }
  root.visaCalendarProbe = {
    sample,
    start({ intervalSeconds = 60, samples = 30, month = expectedMonth } = {}) {
      if (!Number.isInteger(intervalSeconds) || intervalSeconds < 60 || intervalSeconds > 3600) throw new Error('Local sampling interval must be 60–3600 seconds');
      if (!Number.isInteger(samples) || samples < 1 || samples > 120) throw new Error('Use 1–120 local samples');
      stop(); expectedMonth = month; ticks = 1;
      const initial = sample();
      if (samples > 1 && initial.status === 'no_available_dates') {
        timer = root.setInterval(() => {
          try { sample(); if (++ticks >= samples) stop(); }
          catch (e) { stop(); console.error('Local observer stopped:', e.message); }
        }, intervalSeconds * 1000);
      }
      return initial;
    },
    stop,
    exportJSON: () => JSON.stringify(history, null, 2),
  };
  sample();
  console.info('Local observation only; does not refresh or query the server. Start: visaCalendarProbe.start(); Stop: visaCalendarProbe.stop(); Export: visaCalendarProbe.exportJSON()');
})(typeof window === 'undefined' ? {} : window);
