const { Resend } = require("resend");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { to, subject, html } = req.body;
  if (!to || !to.length) return res.status(400).json({ error: "No recipients" });
  if (!html) return res.status(400).json({ error: "No HTML content" });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "RESEND_API_KEY not set" });

  const fromEmail = process.env.FROM_EMAIL || "onboarding@resend.dev";
  const resend = new Resend(apiKey);

  try {
    const recipients = Array.isArray(to) ? to : [to];
    const { error } = await resend.emails.send({
      from: `NY Appellate Digest <${fromEmail}>`,
      to: recipients,
      subject,
      html,
    });

    if (error) {
      console.error("Resend error:", error);
      return res.status(500).json({ error: error.message });
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Send error:", err);
    res.status(500).json({ error: err.message });
  }
};
