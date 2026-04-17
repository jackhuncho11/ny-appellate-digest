const { getNYPublishedOpinionsForDate } = require('../server/nyPublishedOpinions');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { date } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Missing or invalid date param (YYYY-MM-DD)' });
  }
  try {
    const opinions = await getNYPublishedOpinionsForDate(date);
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    return res.status(200).json(opinions);
  } catch (err) {
    console.error('NY opinions fetch error:', err.message);
    return res.status(500).json({ error: err.message });
  }
};
