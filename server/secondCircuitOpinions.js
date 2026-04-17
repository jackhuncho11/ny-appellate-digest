// 2nd Circuit opinions scraper
// Source: ww3.ca2.uscourts.gov/decisions (iSearch)
// Table row format (confirmed from live page):
//   <td><strong><a href="/decisions/isysquery/{uuid}/{n}/doc/{docket}_opn.pdf#xml=...">DOCKET</a></strong></td>
//   <td>CASE NAME</td>
//   <td>MM-DD-YYYY</td>
//   <td>OPN</td>
//
// Only OPN (opinion) rows are included; SUM (summary order) rows are skipped.

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ').replace(/&#039;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ').trim();
}

// "04-10-2026" → "2026-04-10"
function mdyDashToIso(s) {
  const [mm, dd, yyyy] = s.trim().split('-');
  if (!mm || !dd || !yyyy) return '';
  return yyyy + '-' + mm.padStart(2, '0') + '-' + dd.padStart(2, '0');
}

// Strip #xml=... fragment from PDF href
function cleanPdfHref(href) {
  return href.split('#')[0];
}

function makeAbsolute(href) {
  if (!href) return '';
  if (href.startsWith('http')) return href;
  return 'https://ww3.ca2.uscourts.gov' + (href.startsWith('/') ? href : '/' + href);
}

function parseSecondCircuitHtml(html, targetIso) {
  const results = [];

  const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowM;

  while ((rowM = rowRe.exec(html)) !== null) {
    const rowHtml = rowM[1];

    const cells = [];
    const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let cellM;
    while ((cellM = cellRe.exec(rowHtml)) !== null) {
      cells.push({ text: htmlToText(cellM[1]).trim(), html: cellM[1] });
    }

    if (cells.length < 4) continue;

    // Last cell = type; only include OPN
    if (cells[cells.length - 1].text.trim() !== 'OPN') continue;

    // 3rd-to-last cell = date MM-DD-YYYY
    const dateCell = cells[cells.length - 2].text;
    const dateM = dateCell.match(/\b(\d{2}-\d{2}-\d{4})\b/);
    if (!dateM) continue;
    const rowIso = mdyDashToIso(dateM[1]);
    if (rowIso !== targetIso) continue;

    // 2nd-to-last cell = case name
    const caseName = cells[cells.length - 3].text.replace(/\s+/g, ' ').trim();
    if (!caseName) continue;

    // 1st cell = docket number (linked to PDF)
    const docket = cells[0].text.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
    if (!docket) continue;

    // PDF URL from first cell's link
    let pdf_url = '';
    const pdfM = cells[0].html.match(/href="([^"]+\.pdf[^"]*)"/i);
    if (pdfM) {
      pdf_url = makeAbsolute(cleanPdfHref(pdfM[1]));
    }

    results.push({
      case_name: caseName,
      docket,
      court: 'Second Circuit Court of Appeals',
      date: rowIso,
      url: pdf_url,
      pdf_url,
      summary: '',
    });
  }

  return results;
}

async function getSecondCircuitOpinionsForDate(targetIso) {
  const url = 'https://ww3.ca2.uscourts.gov/decisions?IW_DATABASE=OPN&IW_FIELD_TEXT=*&IW_SORT=-Date&IW_BATCHSIZE=50';
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' from ww3.ca2.uscourts.gov');
  const html = await res.text();
  return parseSecondCircuitHtml(html, targetIso);
}

module.exports = { getSecondCircuitOpinionsForDate };
