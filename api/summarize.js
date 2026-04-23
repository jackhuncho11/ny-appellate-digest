module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { case_name, docket, court, url } = req.body;
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

  async function extractOpinionText(pageUrl) {
    if (!pageUrl) return null;
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

  try {
    const opinionText = await extractOpinionText(url);

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
    return res.status(200).json(parseSummaries(text));

  } catch (err) {
    console.error("Summarize error:", err.message);
    return res.status(500).json({ error: err.message });
  }
};
