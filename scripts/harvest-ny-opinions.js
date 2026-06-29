// Harvest all NY published-opinion RSS feeds into data/ny-opinions.json.
//
// Runs in GitHub Actions, NOT on Vercel: GH runners can reach nycourts.gov's
// Cloudflare-protected feeds (node fetch returns 200 there) while Vercel and
// most other hosts get a 403 challenge. The committed JSON is the only source
// that preserves the Appellate Division department for each opinion.
//
// To avoid regressions when a feed is transiently blocked, results merge with
// the previous snapshot: a department whose feed failed this run keeps its prior
// opinions instead of being dropped.

const fs = require('fs');
const path = require('path');
const { harvestAllFeeds } = require('../server/nyPublishedOpinions');

const OUT_FILE = path.join(__dirname, '..', 'data', 'ny-opinions.json');

function loadPrior() {
  try {
    const data = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    return Array.isArray(data.opinions) ? data.opinions : [];
  } catch (_) {
    return [];
  }
}

(async () => {
  const { opinions, errors, succeededCourts } = await harvestAllFeeds();
  if (errors.length) console.error('Feed errors:', JSON.stringify(errors));

  if (!succeededCourts.length) {
    console.error('No feeds succeeded — leaving existing snapshot untouched.');
    process.exit(1);
  }

  // Carry over prior opinions for any department whose feed failed this run, so
  // a transient block never removes a department from the snapshot.
  const succeeded = new Set(succeededCourts);
  const prior = loadPrior();
  const carried = prior.filter(o => !succeeded.has(o.court));

  const merged = [];
  const seen = new Set();
  for (const op of [...opinions, ...carried]) {
    const key = op.docket || op.case_name;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    merged.push(op);
  }
  merged.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const dates = merged.map(o => o.date).filter(Boolean).sort();
  const out = {
    generatedAt: new Date().toISOString(),
    minDate: dates[0] || null,
    maxDate: dates[dates.length - 1] || null,
    count: merged.length,
    succeededCourts,
    errors,
    opinions: merged,
  };

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2) + '\n');
  console.log(
    `Wrote ${merged.length} opinions (${out.minDate}..${out.maxDate}); ` +
    `feeds ok: ${succeededCourts.length}/${succeededCourts.length + errors.length}`
  );
})().catch(err => { console.error(err); process.exit(1); });
