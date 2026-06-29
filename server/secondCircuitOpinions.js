// 2nd Circuit opinions
//
// Primary source: ww3.ca2.uscourts.gov dtSearch (the same endpoint the
// official decisions.html search form posts to). Returns clean HTML rows
// with docket, caption, date, and PDF URL.
//
// Fallback: CourtListener search API. Used when ww3.ca2 is unreachable
// (e.g. F5 firewall blocks the serverless egress IP).

const DT_SEARCH_URL = 'https://ww3.ca2.uscourts.gov/dtSearch/dtisapi6.dll';
const OPN_INDEX = '*{aa12e167958cdbcaa709fa14b9161a4a} OPN';

function htmlToText(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

// "5/4/2026" → "2026-05-04"
function mdySlashToIso(s) {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function makeAbsolute(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return 'https://ww3.ca2.uscourts.gov' + (href.startsWith('/') ? href : '/' + href);
}

function parseDtSearchResults(html) {
  const results = [];
  const rowRe = /<TR\s[^>]*>([\s\S]*?)<\/TR>/gi;
  let m;
  while ((m = rowRe.exec(html)) !== null) {
    const rowHtml = m[1];

    const linkRe = /<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const links = [];
    let lm;
    while ((lm = linkRe.exec(rowHtml)) !== null) {
      links.push({ href: lm[1], text: htmlToText(lm[2]) });
    }
    if (!links.length) continue;

    const pdfLink = links.find(l => /\.pdf(\?|#|$)/i.test(l.href));
    if (!pdfLink) continue;

    // The results HTML now exposes the date as "<B>Date: </B>6/24/2026" and the
    // caption only via a "var captionStr = "...";" assignment inside a <script>
    // block (it used to be inline "Caption:</B><a>...</a>" markup).
    const dateM = rowHtml.match(/Date(?:\s*Posted)?:\s*<\/B>\s*([\d/]+)/i);
    const captionM = rowHtml.match(/var\s+captionStr\s*=\s*"([^"]*)"/i)
      || rowHtml.match(/Caption:\s*<\/B>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const docketM = rowHtml.match(/Docket\s*#:\s*<\/B>\s*<a[^>]*>([\s\S]*?)<\/a>/i);
    const typeM = rowHtml.match(/Type:\s*<\/B>\s*([^<\n]+)/i);

    if (typeM && !/OPN/i.test(typeM[1])) continue;
    if (!dateM || !captionM || !docketM) continue;

    const iso = mdySlashToIso(dateM[1]);
    if (!iso) continue;

    const pdf_url = makeAbsolute(pdfLink.href);
    results.push({
      case_name: htmlToText(captionM[1]),
      docket: htmlToText(docketM[1]).replace(/-cv$|-cr$/i, ''),
      court: 'Second Circuit Court of Appeals',
      date: iso,
      url: pdf_url,
      pdf_url,
      summary: '',
    });
  }
  return results;
}

async function fetchFromDtSearch(targetIso) {
  // dtSearch wants YYYY/MM/DD
  const slashDate = targetIso.replace(/-/g, '/');

  const body = new URLSearchParams();
  body.set('index', OPN_INDEX);
  body.set('request', '');
  body.set('searchType', 'allwords');
  body.set('fileConditions', `xfilter(date "${slashDate}~~${slashDate}")`);
  body.set('booleanConditions', '');
  body.set('cmd', 'search');
  body.set('SearchForm', '');
  body.set('dtsPdfWh', 'x');
  body.set('OrigSearchForm', '/decisions.html');
  body.set('autoStopLimit', '5000');
  body.set('pageSize', '100');
  body.set('sort', 'date');

  const res = await fetch(DT_SEARCH_URL, {
    method: 'POST',
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Origin': 'https://ww3.ca2.uscourts.gov',
      'Referer': 'https://ww3.ca2.uscourts.gov/decisions.html',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from ww3.ca2.uscourts.gov');
  const html = await res.text();
  return parseDtSearchResults(html).filter(r => r.date === targetIso);
}

async function fetchFromCourtListener(targetIso) {
  const params = new URLSearchParams({
    type: 'o',
    court: 'ca2',
    filed_after: targetIso,
    filed_before: targetIso,
    stat_Published: 'on',
    order_by: 'dateFiled desc',
  });
  const headers = { 'Accept': 'application/json' };
  if (process.env.COURTLISTENER_API_KEY) {
    headers['Authorization'] = `Token ${process.env.COURTLISTENER_API_KEY}`;
  }
  const res = await fetch(`https://www.courtlistener.com/api/rest/v4/search/?${params}`, { headers });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from courtlistener.com');
  const data = await res.json();
  const results = [];
  for (const r of data.results || []) {
    if (r.dateFiled !== targetIso) continue;
    const op = (r.opinions || [])[0] || {};
    const pdf_url = op.download_url || '';
    const cl_url = r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : '';
    results.push({
      case_name: r.caseName || '',
      docket: r.docketNumber || '',
      court: 'Second Circuit Court of Appeals',
      date: r.dateFiled,
      url: pdf_url || cl_url,
      pdf_url,
      summary: '',
    });
  }
  return results;
}

async function getSecondCircuitOpinionsForDate(targetIso) {
  try {
    return await fetchFromDtSearch(targetIso);
  } catch (err) {
    console.error('2nd Cir dtSearch failed, falling back to CourtListener:', err.message);
    return await fetchFromCourtListener(targetIso);
  }
}

module.exports = { getSecondCircuitOpinionsForDate };
