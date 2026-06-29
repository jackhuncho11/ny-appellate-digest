// NY Published Opinions — official nycourts.gov RSS feeds
// No API key required; feeds are public and bypass Cloudflare scraping blocks.
//
// Feed URLs (verified):
//   Court of Appeals: https://www.nycourts.gov/reporter/rss/COA.xml
//   AD 1st Dept:      https://www.nycourts.gov/reporter/rss/AD1st.xml
//   AD 2nd Dept:      https://www.nycourts.gov/reporter/rss/AD2nd.xml
//   AD 3rd Dept:      https://www.nycourts.gov/reporter/rss/AD3rd.xml
//   AD 4th Dept:      https://www.nycourts.gov/reporter/rss/AD4th.xml
//   App. Term 1st:    https://nycourts.gov/reporter/RSS/AT1.xml
//   App. Term 2nd:    https://nycourts.gov/reporter/RSS/AT2.xml
//
// NOTE: These feeds have no <pubDate> tag. The decided date is inside
// the <description> HTML as "Month DD, YYYY" (e.g. "April 21, 2026").

const FEEDS = [
  { url: 'https://www.nycourts.gov/reporter/rss/COA.xml',   court: 'New York Court of Appeals' },
  { url: 'https://www.nycourts.gov/reporter/rss/AD1st.xml', court: 'NY App. Div. — 1st Dept.' },
  { url: 'https://www.nycourts.gov/reporter/rss/AD2d.xml',  court: 'NY App. Div. — 2nd Dept.' },
  { url: 'https://www.nycourts.gov/reporter/rss/AD3d.xml',  court: 'NY App. Div. — 3rd Dept.' },
  { url: 'https://www.nycourts.gov/reporter/rss/AD4th.xml', court: 'NY App. Div. — 4th Dept.' },
  { url: 'https://www.nycourts.gov/reporter/rss/AT1.xml',   court: 'NY App. Term — 1st Dept.' },
  { url: 'https://www.nycourts.gov/reporter/rss/AT2.xml',   court: 'NY App. Term — 2nd Dept.' },
];

const MONTHS = {
  january:1, february:2, march:3, april:4, may:5, june:6,
  july:7, august:8, september:9, october:10, november:11, december:12,
};

// Parse "April 21, 2026" → "2026-04-21"
function monthNameToIso(dateStr) {
  if (!dateStr) return '';
  const m = dateStr.match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return '';
  const month = MONTHS[m[1].toLowerCase()];
  if (!month) return '';
  return `${m[3]}-${String(month).padStart(2, '0')}-${String(parseInt(m[2], 10)).padStart(2, '0')}`;
}

// Decode HTML entities and strip tags to plain text
function htmlToPlainText(html) {
  return html
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Extract a tag's raw inner content from XML
function extractTag(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = re.exec(xml);
  if (!m) return '';
  // Strip CDATA wrapper if present
  return m[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '').trim();
}

// The description HTML contains: decided date, docket number, slip citation
function parseDescription(rawDesc) {
  const text = htmlToPlainText(rawDesc);
  // e.g. "decided docket slip April 21, 2026 No. 29 2026 NY Slip Op 02363"
  const dateMatch = text.match(/([A-Z][a-z]+ \d{1,2},?\s+\d{4})/);
  const slipMatch = text.match(/\d{4}\s+NY\s+Slip\s+Op\s+\d+/i);
  return {
    decidedDate: dateMatch ? monthNameToIso(dateMatch[1]) : '',
    docket: slipMatch ? slipMatch[0] : '',
  };
}

function makeAbsolute(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return 'https://www.nycourts.gov' + (href.startsWith('/') ? href : '/' + href);
}

// nycourts.gov decision pages are .shtml; PDFs use the same path with .pdf
function derivePdfUrl(viewUrl) {
  if (!viewUrl) return '';
  const pdf = viewUrl.replace(/\.s?html?$/i, '.pdf');
  return pdf !== viewUrl ? pdf : '';
}

// Pull all <item> blocks out of RSS XML
function parseItems(xml) {
  const items = [];
  const re = /<item[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) items.push(m[1]);
  return items;
}

async function fetchFeed(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)',
      'Accept': 'application/rss+xml, application/xml, text/xml, */*',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  const text = await res.text();
  if (!text.includes('<item')) {
    const preview = text.slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(`No RSS items from ${url} — response: ${preview}`);
  }
  return text;
}

// Parse every published item in a feed into opinion records, each tagged with
// its own decided date and the feed's department/court name.
function parseFeedItems(xml, courtName) {
  const results = [];
  for (const item of parseItems(xml)) {
    const title = extractTag(item, 'title');
    if (!title) continue;
    if (/\[U\]/i.test(title)) continue; // skip unpublished

    const { decidedDate, docket } = parseDescription(extractTag(item, 'description'));
    if (!decidedDate) continue;

    const viewUrl = makeAbsolute(extractTag(item, 'link').trim());
    results.push({
      case_name: title,
      docket,
      court: courtName,
      date: decidedDate,
      url: viewUrl,
      pdf_url: derivePdfUrl(viewUrl),
      summary: '',
    });
  }
  return results;
}

async function getOpinionsFromFeed(feedUrl, courtName, targetIso) {
  const xml = await fetchFeed(feedUrl);
  return parseFeedItems(xml, courtName).filter(o => o.date === targetIso);
}

// Snapshot every recent opinion across all departments. Run by the GitHub
// Actions harvester (GH runners can reach the feeds; Vercel/Cloudflare cannot),
// not at request time. Retries each feed since Cloudflare 403s intermittently.
// Reports which courts succeeded so the caller can avoid overwriting a
// department's data with nothing when its feed is transiently blocked.
async function harvestAllFeeds() {
  const opinions = [];
  const errors = [];
  const succeededCourts = [];

  for (const feed of FEEDS) {
    let xml, lastErr;
    for (let attempt = 0; attempt < 3 && !xml; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, 750 * attempt));
      try { xml = await fetchFeed(feed.url); }
      catch (e) { lastErr = e; }
    }
    if (!xml) {
      console.error('[harvest] ' + feed.court + ':', lastErr && lastErr.message);
      errors.push({ court: feed.court, error: lastErr ? lastErr.message : 'unknown' });
      continue;
    }
    succeededCourts.push(feed.court);
    for (const op of parseFeedItems(xml, feed.court)) opinions.push(op);
  }

  return { opinions, errors, succeededCourts };
}

async function fetchFromRss(targetIso) {
  const all = [];
  const seen = new Set();
  const errors = [];

  for (const feed of FEEDS) {
    try {
      const opinions = await getOpinionsFromFeed(feed.url, feed.court, targetIso);
      for (const op of opinions) {
        const key = op.docket || op.case_name;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(op);
      }
    } catch (err) {
      console.error('[NY RSS] ' + feed.court + ':', err.message);
      errors.push({ court: feed.court, error: err.message });
    }
  }

  return { opinions: all, errors };
}

// CL court_id → display name. nyappdiv is not split by department in CL,
// so AD opinions get a generic label in the fallback path.
const CL_COURT_NAMES = {
  ny: 'New York Court of Appeals',
  nyappdiv: 'NY App. Div.',
  nyappterm: 'NY App. Term',
};

async function fetchFromCourtListener(targetIso) {
  const courts = Object.keys(CL_COURT_NAMES);
  const headers = { 'Accept': 'application/json' };
  if (process.env.COURTLISTENER_API_KEY) {
    headers['Authorization'] = `Token ${process.env.COURTLISTENER_API_KEY}`;
  }

  const all = [];
  const seen = new Set();

  for (const courtId of courts) {
    const params = new URLSearchParams({
      type: 'o',
      court: courtId,
      filed_after: targetIso,
      filed_before: targetIso,
      stat_Published: 'on',
      order_by: 'dateFiled desc',
    });
    const res = await fetch(`https://www.courtlistener.com/api/rest/v4/search/?${params}`, { headers });
    if (!res.ok) {
      console.error('[NY CL] ' + courtId + ': HTTP ' + res.status);
      continue;
    }
    const data = await res.json();
    for (const r of data.results || []) {
      if (r.dateFiled !== targetIso) continue;
      const slipOp = (r.citation && r.citation[0]) || '';
      const op = (r.opinions || [])[0] || {};
      // CL's download_url for NY opinions is the nycourts.gov slip op .shtml.
      const viewUrl = op.download_url || (r.absolute_url ? `https://www.courtlistener.com${r.absolute_url}` : '');
      const pdfUrl = derivePdfUrl(viewUrl);
      const key = slipOp || r.docketNumber || r.caseName;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({
        case_name: r.caseName || '',
        docket: slipOp || r.docketNumber || '',
        court: CL_COURT_NAMES[courtId] || courtId,
        date: r.dateFiled,
        url: viewUrl,
        pdf_url: pdfUrl,
        summary: '',
      });
    }
  }
  return all;
}

// The harvester commits this snapshot to the repo; we read it from the GitHub
// raw CDN (reachable from Vercel) at request time, so fresh harvests appear
// without redeploying. This is the only path that preserves the department for
// Appellate Division opinions.
const HARVEST_URL = 'https://raw.githubusercontent.com/jackhuncho11/ny-appellate-digest/master/data/ny-opinions.json';

async function fetchHarvest() {
  try {
    const res = await fetch(HARVEST_URL, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data && Array.isArray(data.opinions) ? data : null;
  } catch (err) {
    console.error('[NY harvest] fetch failed:', err.message);
    return null;
  }
}

async function getNYPublishedOpinionsForDate(targetIso) {
  // Primary source: the harvested snapshot (departments preserved). Trust it for
  // any date within its rolling window — minDate or newer — including days with
  // genuinely zero opinions. Only dates older than the window fall through.
  const harvest = await fetchHarvest();
  if (harvest && harvest.minDate && targetIso >= harvest.minDate) {
    const opinions = harvest.opinions.filter(o => o.date === targetIso);
    return { opinions, errors: [], source: 'harvest', generatedAt: harvest.generatedAt };
  }

  const { opinions, errors } = await fetchFromRss(targetIso);
  // Cloudflare blocks the RSS feeds intermittently and unevenly — sometimes
  // 3 of 7 feeds work and the rest 403. If any feed errored, merge in
  // CourtListener so we don't silently lose the failed courts. RSS records
  // win on conflicts (slip op match) because they preserve the department.
  if (errors.length > 0) {
    try {
      const clOpinions = await fetchFromCourtListener(targetIso);
      const haveSlipOps = new Set(
        opinions.map(o => o.docket || o.case_name).filter(Boolean)
      );
      const merged = opinions.slice();
      for (const op of clOpinions) {
        const key = op.docket || op.case_name;
        if (haveSlipOps.has(key)) continue;
        haveSlipOps.add(key);
        merged.push(op);
      }
      return {
        opinions: merged,
        errors,
        fallback: merged.length > opinions.length ? 'courtlistener' : undefined,
      };
    } catch (err) {
      console.error('[NY CL fallback] failed:', err.message);
      errors.push({ court: 'CourtListener', error: err.message });
    }
  }
  return { opinions, errors };
}

module.exports = { getNYPublishedOpinionsForDate, harvestAllFeeds };
