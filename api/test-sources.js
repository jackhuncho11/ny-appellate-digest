// Diagnostic endpoint — tests whether each source URL is reachable from Vercel
// Call: GET /api/test-sources

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const results = [];

  // Test CourtListener API
  const clKey = process.env.COURTLISTENER_API_KEY;
  if (!clKey) {
    results.push({ name: 'CourtListener', status: 0, ok: false, error: 'COURTLISTENER_API_KEY not set' });
  } else {
    try {
      const r = await fetch(
        'https://www.courtlistener.com/api/rest/v4/clusters/?docket__court=ny&page_size=2&format=json',
        { headers: { 'Authorization': `Token ${clKey}`, 'Accept': 'application/json' } }
      );
      const text = await r.text();
      results.push({ name: 'CourtListener (ny)', status: r.status, ok: r.ok, preview: text.slice(0, 400) });
    } catch (err) {
      results.push({ name: 'CourtListener (ny)', status: 0, ok: false, error: err.message });
    }
  }

  // Test 2nd Circuit (should be 200)
  try {
    const r = await fetch('https://ww3.ca2.uscourts.gov/decisions?IW_DATABASE=OPN&IW_FIELD_TEXT=*&IW_SORT=-Date&IW_BATCHSIZE=5', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    const text = await r.text();
    results.push({ name: '2nd Circuit', status: r.status, ok: r.ok, preview: text.slice(0, 200).replace(/\s+/g, ' ') });
  } catch (err) {
    results.push({ name: '2nd Circuit', status: 0, ok: false, error: err.message });
  }

  return res.status(200).json(results);
};
