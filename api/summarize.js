const COURT_TO_CL = {
  "New York Court of Appeals":        "ny",
  "NY App. Div. — 1st Dept.":         "nyappdiv",
  "NY App. Div. — 2nd Dept.":         "nyappdiv",
  "NY App. Div. — 3rd Dept.":         "nyappdiv",
  "NY App. Div. — 4th Dept.":         "nyappdiv",
  "NY App. Term — 1st Dept.":         "nyappterm",
  "NY App. Term — 2nd Dept.":         "nyappterm",
  "Second Circuit Court of Appeals":  "ca2",
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { case_name, docket, court, url, pdf_url } = req.body;
  if (!case_name) return res.status(400).json({ error: "Missing case_name" });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "ANTHROPIC_API_KEY not set" });

  const PRACTICE_AREAS = [
    "Criminal Law", "Civil Rights", "Employment / Labor", "Contract / Business",
    "Real Property", "Family Law", "Immigration", "Insurance",
    "Tort / Personal Injury", "Constitutional Law", "Environmental",
    "Intellectual Property", "Tax", "Bankruptcy", "Administrative Law",
    "Evidence / Procedure"
  ].join(", ");

  const prompt = `Please provide two short summaries and practice area tags:

CASE: In 2-4 plain-English sentences, describe what this case is about — the parties, the dispute, and the key legal question presented.

DECISION: In 2-3 plain-English sentences, describe what the court decided — the specific holding, ruling, and outcome.

TAGS: Choose 1-3 of the most relevant practice areas from this list: ${PRACTICE_AREAS}. List them comma-separated.

Respond in exactly this format:
CASE: [your case summary]
DECISION: [your decision summary]
TAGS: [tag1, tag2]`;

  function parseSummaries(text) {
    const caseMatch = text.match(/CASE:\s*([\s\S]*?)(?=DECISION:|$)/i);
    const decisionMatch = text.match(/DECISION:\s*([\s\S]*?)(?=TAGS:|$)/i);
    const tagsMatch = text.match(/TAGS:\s*([\s\S]*?)$/i);
    return {
      case_summary: caseMatch ? caseMatch[1].trim() : "",
      decision_summary: decisionMatch ? decisionMatch[1].trim() : "",
      tags: tagsMatch ? tagsMatch[1].split(",").map(t => t.trim()).filter(Boolean) : [],
    };
  }

  async function extractPdfText(pdfUrl) {
    if (!pdfUrl) return null;
    const encoded = encodeURI(pdfUrl);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const r = await fetch(encoded, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; RSS reader)",
          "Accept": "application/pdf,*/*",
        },
      });
      if (!r.ok) return null;
      const buffer = await r.arrayBuffer();
      const { extractText } = await import("unpdf");
      const { text } = await extractText(new Uint8Array(buffer), { mergePages: true });
      const cleaned = (typeof text === "string" ? text : (text || []).join(" "))
        .replace(/\s+/g, " ").trim();
      if (cleaned.length < 200) return null;
      return cleaned.slice(0, 6000);
    } catch (e) {
      console.error("PDF extract failed:", e.message);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function extractOpinionText(pageUrl) {
    if (!pageUrl) return null;
    if (/\.pdf(\?|#|$)/i.test(pageUrl)) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(pageUrl, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; RSS reader)",
          "Accept": "text/html,*/*",
        },
      });
      if (!r.ok) return null;
      const ct = r.headers.get("content-type") || "";
      if (!/text\/html|xml|text\/plain/i.test(ct)) return null;
      const html = await r.text();
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[\s\S]*?<\/nav>/gi, "")
        .replace(/<header[\s\S]*?<\/header>/gi, "")
        .replace(/<footer[\s\S]*?<\/footer>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
        .replace(/\s+/g, " ").trim();
      if (text.length < 200) return null;
      return text.slice(0, 6000);
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  async function fetchFromCourtListener(caseName, docketStr, courtName) {
    const clApiKey = process.env.COURTLISTENER_API_KEY;
    const courtId = COURT_TO_CL[courtName];
    const headers = { "Accept": "application/json" };
    if (clApiKey) headers["Authorization"] = `Token ${clApiKey}`;

    const yearMatch = docketStr && docketStr.match(/^(\d{4})\s/);

    // Strip Lucene-reserved characters that break CL's search ("In Re:" 500s the API).
    const safeQ = caseName.replace(/[+\-!(){}\[\]^"~*?:\\\/&|]/g, " ").replace(/\s+/g, " ").trim();
    const params = new URLSearchParams({ type: "o", q: safeQ, order_by: "dateFiled desc" });
    if (courtId) params.set("court", courtId);
    if (yearMatch) {
      params.set("filed_after", `${yearMatch[1]}-01-01`);
      params.set("filed_before", `${yearMatch[1]}-12-31`);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const res = await fetch(`https://www.courtlistener.com/api/rest/v4/search/?${params}`, { signal: controller.signal, headers });
      if (!res.ok) return null;
      const data = await res.json();
      const result = (data.results || [])[0];
      if (!result) return null;

      for (const op of (result.opinions || [])) {
        if (!op.id) continue;
        const opRes = await fetch(`https://www.courtlistener.com/api/rest/v4/opinions/${op.id}/`, { signal: controller.signal, headers });
        if (!opRes.ok) continue;
        const opData = await opRes.json();
        const text = (opData.plain_text || "").trim();
        if (text.length > 200) return text.slice(0, 6000);
      }
      return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    // Source priority: PDF text extraction → HTML scrape → CourtListener.
    // ca2 publishes only PDFs; NY decisions also have a sibling .pdf URL that
    // is reachable from serverless even when nycourts.gov .shtml is Cloudflare-blocked.
    const pdfCandidate = pdf_url || (url && /\.pdf(\?|#|$)/i.test(url) ? url : null);
    const opinionText =
      (await extractPdfText(pdfCandidate)) ||
      (await extractOpinionText(url)) ||
      (await fetchFromCourtListener(case_name, docket, court));

    const userMessage = opinionText
      ? `Here is the court opinion for ${case_name} (${docket}), ${court}:\n\n${opinionText}\n\n---\n\n${prompt}`
      : `Summarize this court opinion: ${case_name} (${docket}), ${court}.\n\n${prompt}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        signal: controller.signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 600,
          system: "You are a legal research assistant. Provide accurate, concise summaries of court opinions for legal professionals.",
          messages: [{ role: "user", content: userMessage }],
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      return res.status(response.status).json({ error: errText });
    }

    const data = await response.json();
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
    const parsed = parseSummaries(text);
    if (!parsed.case_summary && !parsed.decision_summary) {
      // Claude returned prose without the CASE:/DECISION: structure — typically
      // a refusal because no opinion content was available. Surface as an error
      // so the UI shows "Unable to summarize" instead of silently rendering nothing.
      return res.status(422).json({ error: "no_summary", raw: text.slice(0, 400) });
    }
    return res.status(200).json(parsed);

  } catch (err) {
    console.error("Summarize error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
