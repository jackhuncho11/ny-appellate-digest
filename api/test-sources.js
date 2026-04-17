// Diagnostic endpoint — tests whether each source URL is reachable from Vercel
// Call: GET /api/test-sources
// Returns: status code + first 300 chars of response for each URL

const URLS = [
  { name: 'NY CoA (shtml)',  url: 'https://www.nycourts.gov/reporter/slipidx/cidxtable.shtml' },
  { name: 'NY AD1 (shtml)', url: 'https://www.nycourts.gov/reporter/slipidx/aidxtable_1.shtml' },
  { name: 'NY AD4 RSS',     url: 'http://courts.state.ny.us/REPORTER/RSS/AD4th.xml' },
  { name: '2nd Cir',        url: 'https://ww3.ca2.uscourts.gov/decisions?IW_DATABASE=OPN&IW_FIELD_TEXT=*&IW_SORT=-Date&IW_BATCHSIZE=10' },
];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nycourts.gov/reporter/',
};

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = [];

  for (const { name, url } of URLS) {
    try {
      const r = await fetch(url, { headers: HEADERS });
      const text = await r.text();
      results.push({
        name,
        url,
        status: r.status,
        ok: r.ok,
        preview: text.slice(0, 300).replace(/\s+/g, ' '),
      });
    } catch (err) {
      results.push({ name, url, status: 0, ok: false, error: err.message });
    }
  }

  return res.status(200).json(results);
};
