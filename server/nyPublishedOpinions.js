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
  { url: 'https://www.nycourts.gov/reporter/rss/AD2nd.xml', court: 'NY App. Div. — 2nd Dept.' },
  { url: 'https://www.nycourts.gov/reporter/rss/AD3rd.xml', court: 'NY App. Div. — 3rd Dept.' },
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
  // Reject Cloudflare HTML error pages disguised as 200
  if (!text.includes('<item')) throw new Error(`No RSS items in response from ${url}`);
  return text;
}

async function getOpinionsFromFeed(feedUrl, courtName, targetIso) {
  const xml = await fetchFeed(feedUrl);
  const items = parseItems(xml);
  const results = [];

  for (const item of items) {
    const title = extractTag(item, 'title');
    if (!title) continue;
    if (/\[U\]/i.test(title)) continue; // skip unpublished

    const rawDesc = extractTag(item, 'description');
    const { decidedDate, docket } = parseDescription(rawDesc);

    if (decidedDate !== targetIso) continue;

    const rawLink = extractTag(item, 'link').trim();
    const viewUrl = makeAbsolute(rawLink);
    const pdfUrl = derivePdfUrl(viewUrl);

    results.push({
      case_name: title,
      docket,
      court: courtName,
      date: targetIso,
      url: viewUrl,
      pdf_url: pdfUrl,
      summary: '',
    });
  }

  return results;
}

async function getNYPublishedOpinionsForDate(targetIso) {
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

module.exports = { getNYPublishedOpinionsForDate };
