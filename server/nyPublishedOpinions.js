// NY Published Opinions scraper
// Sources: nycourts.gov Law Reporting Bureau slip opinion index tables
// Note: nycourts.gov blocks some automated requests — if 403, check Vercel logs and
//       consider adding Referer/Cookie headers or switching to the RSS feeds below.
//
// Per-court RSS feeds (fallback if HTTP scraping is blocked):
//   Court of Appeals:  https://www.nycourts.gov/reporter/rss/COA.xml
//   AD 1st Dept:       https://www.nycourts.gov/reporter/rss/AD1st.xml
//   AD 2nd Dept:       https://www.nycourts.gov/reporter/rss/AD2nd.xml
//   AD 3rd Dept:       https://www.nycourts.gov/reporter/rss/AD3rd.xml
//   AD 4th Dept:       http://courts.state.ny.us/REPORTER/RSS/AD4th.xml

const SOURCES = [
  { url: 'https://www.nycourts.gov/reporter/slipidx/cidxtable.shtml',   court: 'New York Court of Appeals' },
  { url: 'https://www.nycourts.gov/reporter/slipidx/aidxtable_1.shtml', court: 'NY App. Div. — 1st Dept.' },
  { url: 'https://www.nycourts.gov/reporter/slipidx/aidxtable_2.shtml', court: 'NY App. Div. — 2nd Dept.' },
  { url: 'https://www.nycourts.gov/reporter/slipidx/aidxtable_3.shtml', court: 'NY App. Div. — 3rd Dept.' },
  { url: 'https://www.nycourts.gov/reporter/slipidx/aidxtable_4.shtml', court: 'NY App. Div. — 4th Dept.' },
];

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

// Build both zero-padded and non-padded date strings for matching
// e.g. "2026-04-07" → ["04/07/2026", "4/7/2026"]
function isoToNYDateVariants(iso) {
  const [yyyy, mm, dd] = iso.split('-');
  return [
    mm + '/' + dd + '/' + yyyy,
    String(parseInt(mm, 10)) + '/' + String(parseInt(dd, 10)) + '/' + yyyy,
  ];
}

// Extract all <a> tags with href from an HTML fragment
function extractLinks(html) {
  const links = [];
  const re = /href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    links.push({ href: m[1], text: htmlToText(m[2]).trim() });
  }
  return links;
}

function makeAbsolute(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return 'https://www.nycourts.gov' + (href.startsWith('/') ? href : '/' + href);
}

function parseNYTableHtml(html, targetIso, courtName) {
  const results = [];
  const dateVariants = isoToNYDateVariants(targetIso);

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowM;

  while ((rowM = rowRe.exec(html)) !== null) {
    const rowHtml = rowM[1];
    const rowText = htmlToText(rowHtml);

    // Skip rows without our target date
    if (!dateVariants.some(d => rowText.includes(d))) continue;

    // Skip unpublished opinions (marked [U]) — they won't have PDFs
    if (/\[U\]/i.test(rowText)) continue;

    const links = extractLinks(rowHtml);

    let caseName = '';
    let viewUrl = '';
    let pdfUrl = '';

    for (const link of links) {
      const t = link.text;
      const h = link.href.toLowerCase();

      // PDF link: href ends in .pdf
      if (h.includes('.pdf') && !pdfUrl) {
        pdfUrl = makeAbsolute(link.href);
        continue;
      }
      // PDF link: link text is "PDF"
      if (/^PDF$/i.test(t) && !pdfUrl) {
        pdfUrl = makeAbsolute(link.href);
        continue;
      }
      // Skip non-case-name links
      if (!t) continue;
      if (/^(HTML?|Full\s+Decision|Decision|View|PDF)$/i.test(t)) {
        if (!viewUrl) viewUrl = makeAbsolute(link.href);
        continue;
      }
      if (/^\d+$/.test(t)) continue;
      if (/\d{4}\s+NY\s+Slip/i.test(t)) continue;

      // First meaningful link text is the case name
      if (!caseName) {
        caseName = t;
        viewUrl = makeAbsolute(link.href);
      }
    }

    // Also grab PDF by href pattern if not already found
    if (!pdfUrl) {
      const m2 = rowHtml.match(/href="([^"]*\.pdf[^"]*)"/i);
      if (m2) pdfUrl = makeAbsolute(m2[1]);
    }

    if (!caseName) continue;

    // Use NY Slip Op citation as the docket identifier
    const slipM = rowText.match(/\d{4}\s+NY\s+Slip\s+Op\s+\d+/i);
    const docket = slipM ? slipM[0] : '';

    results.push({
      case_name: caseName,
      docket,
      court: courtName,
      date: targetIso,
      url: viewUrl || pdfUrl,
      pdf_url: pdfUrl,
      summary: '',
    });
  }

  return results;
}

async function fetchSource(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.nycourts.gov/reporter/',
    },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from ' + url);
  return res.text();
}

async function getNYPublishedOpinionsForDate(targetIso) {
  const all = [];
  const seen = new Set();

  for (const source of SOURCES) {
    try {
      const html = await fetchSource(source.url);
      const opinions = parseNYTableHtml(html, targetIso, source.court);
      for (const op of opinions) {
        const key = op.docket || op.case_name;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(op);
      }
    } catch (err) {
      console.error('[NY scraper] ' + source.court + ':', err.message);
      // Continue — partial results are better than none
    }
  }

  return all;
}

module.exports = { getNYPublishedOpinionsForDate };
