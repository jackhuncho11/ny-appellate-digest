// Use lib path to bypass pdf-parse's self-test which crashes in serverless
const pdfParse = require("pdf-parse/lib/pdf-parse.js");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { case_name, docket, court, pdf_url } = req.body;
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
    const tags = tagsMatch
      ? tagsMatch[1].split(",").map(t => t.trim()).filter(Boolean)
      : [];
    return {
      case_summary: caseMatch ? caseMatch[1].trim() : "",
      decision_summary: decisionMatch ? decisionMatch[1].trim() : "",
      tags,
    };
  }

  // Estimate tokens: ~4 characters per token
  function estimateTokens(text) {
    return Math.ceil(text.length / 4);
  }

  // Extract first 3 pages + last 2 pages from PDF text
  async function extractPdfExcerpt(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const pdfRes = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
          "Accept": "application/pdf,*/*",
        },
      });
      if (!pdfRes.ok) {
        console.warn("PDF fetch HTTP error:", pdfRes.status);
        return null;
      }
      const contentLength = parseInt(pdfRes.headers.get("content-length") || "0");
      if (contentLength > 15 * 1024 * 1024) {
        console.warn("PDF too large:", contentLength);
        return null;
      }
      const buffer = Buffer.from(await pdfRes.arrayBuffer());
      if (buffer.byteLength > 15 * 1024 * 1024) return null;

      const data = await pdfParse(buffer);
      const allText = data.text || "";
      if (allText.trim().length < 100) return null;

      // Split into pages by form feed character
      const pages = allText.split(/\f/).filter(p => p.trim().length > 50);

      let excerpt;
      if (pages.length <= 5) {
        excerpt = allText;
      } else {
        const first3 = pages.slice(0, 3).join("\n\n");
        const last2 = pages.slice(-2).join("\n\n");
        excerpt = first3 + "\n\n[...middle omitted...]\n\n" + last2;
      }

      // Target ~3,000 tokens of PDF text: take first 8,000 + last 4,000 chars
      const MAX_CHARS = 12000;
      if (excerpt.length > MAX_CHARS) {
        const head = excerpt.slice(0, 8000);
        const tail = excerpt.slice(-4000);
        excerpt = head + "\n\n[...middle omitted...]\n\n" + tail;
      }

      console.log(`PDF excerpt: ${pages.length} pages, ${estimateTokens(excerpt)} est. tokens`);
      return excerpt;
    } catch (err) {
      console.warn("PDF extract error:", err.message);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  try {
    let userMessage;

    if (pdf_url) {
      const excerpt = await extractPdfExcerpt(pdf_url);
      if (excerpt) {
        const fullText = `Here is the court opinion for ${case_name} (${docket}), ${court}:\n\n${excerpt}\n\n---\n\n${prompt}`;
        const estTokens = estimateTokens(fullText);

        // Final token safety check — if still over 3,500, trim the excerpt further
        if (estTokens > 3500) {
          const trimmed = excerpt.slice(0, 6000) + "\n\n[...]\n\n" + excerpt.slice(-2000);
          userMessage = `Here is the court opinion for ${case_name} (${docket}), ${court}:\n\n${trimmed}\n\n---\n\n${prompt}`;
          console.log(`Trimmed to ${estimateTokens(userMessage)} est. tokens`);
        } else {
          userMessage = fullText;
        }
      }
    }

    // Fall back to text-only if no PDF
    if (!userMessage) {
      console.log("Text-only fallback for:", docket);
      userMessage = `Summarize this court opinion: ${case_name} (${docket}), ${court}.\n\n${prompt}`;
    }

    const anthropicController = new AbortController();
    const anthropicTimeout = setTimeout(() => anthropicController.abort(), 45000);

    let response;
    try {
      response = await fetch("https://api.anthropic.com/v1/messages", {
        signal: anthropicController.signal,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 600,
          system: "You are a legal research assistant. Provide accurate, concise summaries of court opinions for legal professionals.",
          messages: [{ role: "user", content: userMessage }],
        }),
      });
    } finally {
      clearTimeout(anthropicTimeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("Anthropic error:", response.status, errText);
      // Pass 429 through so the client can handle rate limiting
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
