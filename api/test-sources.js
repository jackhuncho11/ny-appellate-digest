// Diagnostic endpoint — tests whether each source URL is reachable from Vercel
// Call: GET /api/test-sources

const RSS_FEEDS = [
  { name: 'NY Court of Appeals (RSS)', url: 'https://www.nycourts.gov/reporter/rss/COA.xml' },
  { name: 'NY App. Div. 1st Dept (RSS)', url: 'https://www.nycourts.gov/reporter/rss/AD1st.xml' },
  { name: 'NY App. Div. 2nd Dept (RSS)', url: 'https://www.nycourts.gov/reporter/rss/AD2nd.xml' },
  { name: 'NY App. Div. 3rd Dept (RSS)', url: 'https://www.nycourts.gov/reporter/rss/AD3rd.xml' },
  { name: 'NY App. Div. 4th Dept (RSS)', url: 'https://www.nycourts.gov/reporter/rss/AD4th.xml' },
  { name: 'NY App. Term 1st Dept (RSS)', url: 'https://nycourts.gov/reporter/RSS/AT1.xml' },
  { name: 'NY App. Term 2nd Dept (RSS)', url: 'https://nycourts.gov/reporter/RSS/AT2.xml' },
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = [];

  // Test each NY courts RSS feed
  for (const feed of RSS_FEEDS) {
    try {
      const r = await fetch(feed.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; RSS reader)',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        },
      });
      const text = await r.text();
      const itemCount = (text.match(/<item/g) || []).length;
      // Extract first item block verbatim for date debugging
      const firstItemMatch = text.match(/<item[^>]*>([\s\S]*?)<\/item>/i);
      results.push({
        name: feed.name,
        status: r.status,
        ok: r.ok,
        items: itemCount,
        firstItem: firstItemMatch ? firstItemMatch[1].replace(/\s+/g, ' ').slice(0, 500) : null,
      });
    } catch (err) {
      results.push({ name: feed.name, status: 0, ok: false, error: err.message });
    }
  }

  // Test 2nd Circuit
  try {
    const r = await fetch('https://ww3.ca2.uscourts.gov/decisions?IW_DATABASE=OPN&IW_FIELD_TEXT=*&IW_SORT=-Date&IW_BATCHSIZE=5', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' },
    });
    const text = await r.text();
    results.push({ name: '2nd Circuit', status: r.status, ok: r.ok, preview: text.slice(0, 200).replace(/\s+/g, ' ') });
  } catch (err) {
    results.push({ name: '2nd Circuit', status: 0, ok: false, error: err.message });
  }

  return res.status(200).json(results);
};
