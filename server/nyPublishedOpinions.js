// NY Published Opinions — CourtListener API
// Free API key required: https://www.courtlistener.com/sign-in/ → Profile → API token
// Add as Vercel env var: COURTLISTENER_API_KEY
//
// Court IDs:
//   ny        → New York Court of Appeals
//   nyappdiv  → NY Appellate Division (all departments combined)

const CL_BASE = 'https://www.courtlistener.com/api/rest/v4';

const COURT_DISPLAY = {
  ny:       'New York Court of Appeals',
  nyappdiv: 'NY Appellate Division',
};

// CourtListener cluster → opinion object
// Cluster fields: id, case_name, date_filed, absolute_url, citations[], sub_opinions[]
// Sub-opinion fields: resource_uri, type, download_url
async function fetchClusters(courtId, targetIso, apiKey) {
  const results = [];
  let url = `${CL_BASE}/clusters/?docket__court=${courtId}&date_filed=${targetIso}&page_size=100&format=json`;

  while (url) {
    const res = await fetch(url, {
      headers: {
        'Authorization': `Token ${apiKey}`,
        'Accept': 'application/json',
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`CourtListener ${res.status} for court=${courtId}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();

    for (const cluster of (data.results || [])) {
      const caseName = (cluster.case_name || cluster.case_name_full || '').trim();
      if (!caseName) continue;

      // Build the CourtListener view URL
      const viewUrl = cluster.absolute_url
        ? 'https://www.courtlistener.com' + cluster.absolute_url
        : '';

      // Extract best citation as docket identifier
      let docket = '';
      if (cluster.citations && cluster.citations.length > 0) {
        const c = cluster.citations[0];
        docket = [c.volume, c.reporter, c.page].filter(Boolean).join(' ');
      }
      // Fall back to cluster ID
      if (!docket) docket = 'CL-' + cluster.id;

      // PDF: look for download_url in sub_opinions
      // sub_opinions may be an array of URLs (strings) or objects
      let pdfUrl = '';
      const subs = cluster.sub_opinions || [];
      for (const sub of subs) {
        if (typeof sub === 'object' && sub.download_url) {
          pdfUrl = sub.download_url;
          break;
        }
      }
      // If sub_opinions are URLs not objects, skip — we'll fetch PDF on summarize

      // Detect AD department from case_name or cluster metadata if available
      let court = COURT_DISPLAY[courtId] || courtId;
      if (courtId === 'nyappdiv') {
        // CourtListener sometimes includes dept info in the docket's court_short_name
        // If available, use it; otherwise fall back to generic label
        const shortName = cluster.docket_short_name || '';
        if (/1st/i.test(shortName)) court = 'NY App. Div. — 1st Dept.';
        else if (/2nd/i.test(shortName)) court = 'NY App. Div. — 2nd Dept.';
        else if (/3rd/i.test(shortName)) court = 'NY App. Div. — 3rd Dept.';
        else if (/4th/i.test(shortName)) court = 'NY App. Div. — 4th Dept.';
      }

      results.push({
        case_name: caseName,
        docket,
        court,
        date: targetIso,
        url: viewUrl,
        pdf_url: pdfUrl,
        summary: '',
      });
    }

    url = data.next || null;
  }

  return results;
}

async function getNYPublishedOpinionsForDate(targetIso) {
  const apiKey = process.env.COURTLISTENER_API_KEY;
  if (!apiKey) throw new Error('COURTLISTENER_API_KEY env var not set. Get a free token at courtlistener.com');

  const all = [];
  const seen = new Set();

  for (const courtId of Object.keys(COURT_DISPLAY)) {
    try {
      const opinions = await fetchClusters(courtId, targetIso, apiKey);
      for (const op of opinions) {
        const key = op.docket || op.case_name;
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(op);
      }
    } catch (err) {
      console.error('[CourtListener] court=' + courtId + ':', err.message);
    }
  }

  return all;
}

module.exports = { getNYPublishedOpinionsForDate };
