import { useState, useCallback, useRef } from "react";

function prevBusinessDay() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  const yyyy = d.getFullYear(), mm = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  return { iso: `${yyyy}-${mm}-${dd}` };
}
const DEFAULT_DATE = prevBusinessDay();

function isoToLabel(iso) {
  const [y,m,d] = iso.split("-").map(Number);
  return new Date(y,m-1,d).toLocaleDateString("en-US",{weekday:"long",year:"numeric",month:"long",day:"numeric"});
}

const COURT_ORDER = [
  "New York Court of Appeals",
  "Second Circuit Court of Appeals",
  "NY App. Div. — 1st Dept.",
  "NY App. Div. — 2nd Dept.",
  "NY App. Div. — 3rd Dept.",
  "NY App. Div. — 4th Dept.",
];

function sortedCourts(bc) {
  return Object.keys(bc).sort((a,b) => {
    const ai = COURT_ORDER.indexOf(a), bi = COURT_ORDER.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1; if (bi === -1) return -1; return ai - bi;
  });
}

function buildEmailHTML(decisions, courts, byCourt, summaries, dateLabel) {
  let rows = "";
  for (const court of courts) {
    let cases = "";
    for (const c of byCourt[court]) {
      const sum = summaries[c.docket || c.case_name] || {};
      const caseSum = sum.case_summary || "";
      const decisionSum = sum.decision_summary || "";
      const tags = sum.tags || [];
      const tagHtml = tags.map(t =>
        "<span style='display:inline-block;background:#fff3e0;color:#e65100;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;margin-right:4px;letter-spacing:0.5px;'>" + t + "</span>"
      ).join("");
      cases += "<div style='padding:10px 14px;border-bottom:1px solid #eeeeee;'>"
        + "<div style='font-size:10px;color:#999999;'>" + (c.docket || "") + " &middot; " + (c.date || "") + "</div>"
        + "<div style='font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#111111;'>" + c.case_name + "</div>"
        + (tagHtml ? "<div style='margin-top:5px;'>" + tagHtml + "</div>" : "")
        + (caseSum ? "<div style='font-size:12px;color:#58595b;margin-top:4px;line-height:1.5;'><strong>Case:</strong> " + caseSum + "</div>" : "")
        + (decisionSum ? "<div style='font-size:12px;color:#58595b;margin-top:4px;line-height:1.5;'><strong>Decision:</strong> " + decisionSum + "</div>" : "")
        + "<div style='margin-top:4px;'>"
        + (c.url ? "<a href='" + c.url + "' style='font-size:11px;color:#ff8200;font-weight:600;text-decoration:none;margin-right:12px;'>View &rarr;</a>" : "")
        + (c.pdf_url ? "<a href='" + c.pdf_url + "' style='font-size:11px;color:#ff8200;font-weight:600;text-decoration:none;'>PDF &darr;</a>" : "")
        + "</div></div>";
    }
    rows += "<div style='margin-bottom:18px'>"
      + "<div style='background:#f5f5f5;padding:6px 14px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#111111;border-left:4px solid #ff8200;'>" + court + " (" + byCourt[court].length + ")</div>"
      + cases + "</div>";
  }
  return "<!DOCTYPE html><html><head><meta charset='UTF-8'></head><body>"
    + "<div style='max-width:680px;margin:0 auto;background:#ffffff;font-family:Arial,sans-serif;'>"
    + "<div style='background:#ffffff;padding:24px 20px 16px;text-align:center;border-bottom:3px solid #ff8200;'>"
    + "<div style='font-size:10px;color:#999999;letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;'>Daily Report &middot; Official Sources</div>"
    + "<div style='font-family:Arial,sans-serif;font-size:22px;color:#111111;font-weight:700;letter-spacing:1px;'>NEW YORK &amp; 2ND CIRCUIT<br>APPELLATE DECISION DIGEST</div>"
    + "<div style='font-size:12px;color:#58595b;margin-top:8px;'>" + dateLabel + "</div></div>"
    + "<div>" + (rows || "<p style='padding:20px;color:#999999;text-align:center;'>No published opinions found.</p>") + "</div>"
    + "<div style='background:#f5f5f5;padding:12px;text-align:center;font-size:10px;color:#999999;border-top:1px solid #eeeeee;'>"
    + decisions.length + " opinion" + (decisions.length !== 1 ? "s" : "") + " &middot; nycourts.gov &amp; ww3.ca2.uscourts.gov"
    + "</div></div></body></html>";
}

async function summarizeOpinion(c) {
  try {
    const res = await fetch("/api/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        case_name: c.case_name,
        docket: c.docket,
        court: c.court,
        url: c.url,
        pdf_url: c.pdf_url,
      }),
    });
    if (res.status === 429) return { case_summary: "", decision_summary: "", rateLimited: true };
    if (!res.ok) return { case_summary: "", decision_summary: "", error: true };
    const data = await res.json();
    if (data.error) return { case_summary: "", decision_summary: "", tags: [], error: true };
    return { case_summary: data.case_summary || "", decision_summary: data.decision_summary || "", tags: data.tags || [] };
  } catch { return { case_summary: "", decision_summary: "", error: true }; }
}

function Spinner({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      style={{ animation: "spin 1s linear infinite", display: "inline-block", verticalAlign: "middle" }}>
      <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
    </svg>
  );
}

function TabBtn({ label, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      background: "none", border: "none", padding: "10px 14px", cursor: "pointer",
      fontSize: 13, fontWeight: 600,
      color: active ? "#111111" : "#999999",
      borderBottom: active ? "2px solid #111111" : "2px solid transparent",
      marginBottom: -2,
    }}>{label}</button>
  );
}

export default function App() {
  const [selectedDate, setSelectedDate] = useState(DEFAULT_DATE.iso);
  const [nyDecisions, setNyDecisions] = useState([]);
  const [secondDecisions, setSecondDecisions] = useState([]);
  const [nyPhase, setNyPhase] = useState("idle");
  const [nyError, setNyError] = useState(null);
  const [secondPhase, setSecondPhase] = useState("idle");
  const [summaries, setSummaries] = useState({});
  const [sumPhase, setSumPhase] = useState("idle");
  const [recipients, setRecipients] = useState(() => localStorage.getItem("ny_recipients") || "");
  const [tab, setTab] = useState("main");
  const [progress, setProgress] = useState("");
  const [sendPhase, setSendPhase] = useState("idle");
  const [sendResult, setSendResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const emailHTMLRef = useRef("");
  const emailSubjectRef = useRef("");
  const recipientsRef = useRef("");
  recipientsRef.current = recipients;

  const handleDateChange = useCallback((newDate) => {
    setSelectedDate(newDate);
    setNyDecisions([]); setSecondDecisions([]);
    setNyPhase("idle"); setNyError(null);
    setSecondPhase("idle"); setSummaries({});
    setSumPhase("idle"); setSendResult(null);
  }, []);

  const fetchNY = useCallback(async () => {
    setNyPhase("fetching"); setNyError(null); setProgress("Fetching NY courts…");
    try {
      const res = await fetch("/api/ny-opinions?date=" + selectedDate);
      if (!res.ok) throw new Error("NY API " + res.status);
      setNyDecisions(await res.json());
      setNyPhase("done");
    } catch (err) {
      setNyDecisions([]); setNyError(err.message); setNyPhase("error");
    }
    setProgress("");
  }, [selectedDate]);

  const fetchSecond = useCallback(async () => {
    setSecondPhase("fetching"); setProgress("Fetching 2nd Circuit…");
    try {
      const res = await fetch("/api/second-opinions?date=" + selectedDate);
      if (!res.ok) throw new Error("2nd Circuit API " + res.status);
      setSecondDecisions(await res.json());
      setSecondPhase("done");
    } catch {
      setSecondDecisions([]); setSecondPhase("error");
    }
    setProgress("");
  }, [selectedDate]);

  const fetchAll = useCallback(() => {
    fetchNY(); fetchSecond();
  }, [fetchNY, fetchSecond]);

  const doSummaries = useCallback(async (cases) => {
    setSumPhase("fetching");
    for (let i = 0; i < cases.length; i++) {
      const c = cases[i];
      setProgress(`Summarizing ${i + 1} of ${cases.length}: ${c.case_name}…`);
      const result = await summarizeOpinion(c);
      setSummaries(prev => ({ ...prev, [c.docket || c.case_name]: result }));
      // 30-second delay between calls to stay under 10k tokens/min rate limit
      if (i < cases.length - 1) await new Promise(r => setTimeout(r, 30000));
    }
    setSumPhase("done"); setProgress("");
  }, []);

  const copyHTML = useCallback(async () => {
    const html = emailHTMLRef.current;
    if (!html) return;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) })
      ]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch { setCopied(false); }
  }, []);

  const openGmail = useCallback(async () => {
    const html = emailHTMLRef.current;
    const subject = emailSubjectRef.current;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) })
      ]);
    } catch {}
    const rcpts = recipientsRef.current.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);
    window.open("https://mail.google.com/mail/?view=cm&fs=1&to=" + encodeURIComponent(rcpts.join(",")) + "&su=" + encodeURIComponent(subject), "_blank");
  }, []);

  const openOutlook = useCallback(async () => {
    const html = emailHTMLRef.current;
    const subject = emailSubjectRef.current;
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) })
      ]);
    } catch {}
    const rcpts = recipientsRef.current.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);
    window.open("https://outlook.office.com/mail/deeplink/compose?to=" + encodeURIComponent(rcpts.join(";")) + "&subject=" + encodeURIComponent(subject), "_blank");
  }, []);

  const sendViaResend = useCallback(async () => {
    const rcpts = recipientsRef.current.split(/[\n,]+/).map(r => r.trim()).filter(Boolean);
    const html = emailHTMLRef.current;
    const subject = emailSubjectRef.current;
    if (!rcpts.length) { setSendResult({ ok: false, msg: "No recipients entered." }); return; }
    if (!html) { setSendResult({ ok: false, msg: "Fetch opinions first." }); return; }
    setSendPhase("sending"); setSendResult(null);
    try {
      const res = await fetch("/api/send-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: rcpts, subject, html }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Send failed");
      setSendResult({ ok: true, msg: "Sent to " + rcpts.join(", ") });
    } catch (err) {
      setSendResult({ ok: false, msg: err.message });
    }
    setSendPhase("idle");
  }, []);

  const allDecisions = [...nyDecisions, ...secondDecisions];
  const byCourt = allDecisions.reduce((a, d) => { (a[d.court] = a[d.court] || []).push(d); return a; }, {});
  const courts = sortedCourts(byCourt);
  const sumCount = Object.values(summaries).filter(s => s && (s.case_summary || s.decision_summary)).length;
  const dateLabel = isoToLabel(selectedDate);
  const anyFetching = nyPhase === "fetching" || secondPhase === "fetching";
  const emailSubject = "NY + 2nd Circuit Appellate Daily Digest — " + dateLabel;
  const emailHTML = allDecisions.length ? buildEmailHTML(allDecisions, courts, byCourt, summaries, dateLabel) : "";

  emailHTMLRef.current = emailHTML;
  emailSubjectRef.current = emailSubject;

  return (
    <div style={{ fontFamily: "Arial,sans-serif", background: "#fbfbfb", minHeight: "100vh", paddingBottom: 40 }}>
      <div style={{ background: "#ffffff", color: "#111111", padding: "14px 24px", borderBottom: "3px solid #ff8200" }}>
        <div style={{ fontSize: 10, color: "#999999", letterSpacing: 2, textTransform: "uppercase" }}>Daily Report Agent</div>
        <div style={{ fontSize: 18, fontFamily: "Arial,sans-serif", fontWeight: 700, letterSpacing: 1 }}>NY + 2ND CIRCUIT APPELLATE DIGEST</div>
      </div>
      <div style={{ background: "#fff", borderBottom: "2px solid #e5e5e5", padding: "0 24px", display: "flex" }}>
        <TabBtn label="📄 Digest" active={tab === "main"} onClick={() => setTab("main")} />
        <TabBtn label="✉️ Send" active={tab === "send"} onClick={() => setTab("send")} />
      </div>
      <div style={{ maxWidth: 800, margin: "0 auto", padding: "20px 16px" }}>

        {tab === "main" && (
          <>
            <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 16px", marginBottom: 14, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
              <label style={{ fontSize: 12, fontWeight: 700, color: "#333333", whiteSpace: "nowrap" }}>📅 Date</label>
              <input type="date" value={selectedDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={e => handleDateChange(e.target.value)}
                style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, color: "#111111", cursor: "pointer", outline: "none" }} />
              <span style={{ fontSize: 13, color: "#58595b", flex: 1 }}>{dateLabel}</span>
              <button onClick={fetchAll} disabled={anyFetching || !selectedDate}
                style={{ background: anyFetching ? "#9ca3af" : "#111111", color: "#fff", border: "none", borderRadius: 6, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: anyFetching ? "not-allowed" : "pointer", display: "flex", alignItems: "center", gap: 6 }}>
                {anyFetching ? <><Spinner size={13} /> Fetching…</> : "Fetch All →"}
              </button>
            </div>

            <div style={{ display: "flex", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
              {[
                { label: "NY Courts",   phase: nyPhase,     count: nyDecisions.length,     err: nyError, fn: fetchNY },
                { label: "2nd Circuit", phase: secondPhase, count: secondDecisions.length, err: null,    fn: fetchSecond },
              ].map(({ label, phase, count, err, fn }) => (
                <div key={label} style={{ flex: 1, minWidth: 200, background: "#fff", borderRadius: 8, padding: "10px 14px", border: "2px solid " + (phase === "error" ? "#fca5a5" : phase === "done" ? "#ff8200" : "#e2e8f0"), display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: "#333333", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
                    <div style={{ fontSize: 13, marginTop: 2, color: phase === "error" ? "#dc2626" : phase === "done" ? "#ff8200" : "#999999" }}>
                      {phase === "idle" && "Not fetched"}
                      {phase === "fetching" && <><Spinner size={12} /> Fetching…</>}
                      {phase === "done" && "✅ " + count + " opinion" + (count !== 1 ? "s" : "")}
                      {phase === "error" && "❌ " + (err || "Fetch failed")}
                    </div>
                  </div>
                  <button onClick={fn} disabled={phase === "fetching"}
                    style={{ background: phase === "fetching" ? "#9ca3af" : "#111111", color: "#fff", border: "none", borderRadius: 6, padding: "6px 12px", fontSize: 11, fontWeight: 600, cursor: phase === "fetching" ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
                    {phase === "done" ? "Re-fetch" : "Fetch →"}
                  </button>
                </div>
              ))}
            </div>

            {allDecisions.length === 0 && !anyFetching && (
              <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "40px 24px", textAlign: "center" }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>⚖️</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: "#111111", marginBottom: 8 }}>Ready to build your digest</div>
                <div style={{ fontSize: 13, color: "#58595b", maxWidth: 400, margin: "0 auto", lineHeight: 1.6 }}>
                  Pick a date and click <strong>Fetch All →</strong> to load published opinions.
                </div>
              </div>
            )}

            {allDecisions.length > 0 && (
              <>
                <div style={{ background: "#f9f9f9", border: "1px solid #e5e5e5", borderRadius: 8, padding: "9px 14px", marginBottom: 14, fontSize: 12, color: "#111111", display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <span>📋 <strong>{allDecisions.length}</strong> opinions</span>
                  {courts.map(c => (
                    <span key={c} style={{ fontSize: 11 }}>
                      · <strong>{byCourt[c].length}</strong>{" "}
                      {c.replace("New York Court of Appeals", "NY CoA").replace("Second Circuit Court of Appeals", "2nd Cir.").replace("NY App. Div. — ", "AD ")}
                    </span>
                  ))}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
                    {progress && <span style={{ fontSize: 11, color: "#58595b" }}>{progress}</span>}
                    {sumPhase === "idle" && <button onClick={() => doSummaries(allDecisions)} style={{ background: "#ff8200", color: "#fff", border: "none", borderRadius: 5, padding: "5px 10px", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>✨ Summaries</button>}
                    {sumPhase === "fetching" && <span style={{ fontSize: 11, color: "#ff8200" }}><Spinner size={11} /> Summarizing…</span>}
                    {sumPhase === "done" && <span style={{ fontSize: 11, color: "#ff8200", fontWeight: 700 }}>✨ {sumCount}</span>}
                  </div>
                </div>

                <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 10, overflow: "hidden", boxShadow: "0 1px 3px rgba(0,0,0,.06)" }}>
                  <div style={{ background: "#f8fafc", borderBottom: "1px solid #e2e8f0", padding: "9px 16px", fontSize: 11, color: "#58595b" }}>
                    <div><span style={{ color: "#9ca3af" }}>To: </span>{recipients || <em style={{ color: "#cbd5e1" }}>Set in Send tab</em>}</div>
                    <div><span style={{ color: "#9ca3af" }}>Subject: </span>{emailSubject}</div>
                  </div>
                  <div style={{ background: "#ffffff", padding: "20px", textAlign: "center", borderBottom: "3px solid #ff8200" }}>
                    <div style={{ fontSize: 10, color: "#999999", letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 }}>Daily Report · Official Sources</div>
                    <div style={{ fontFamily: "Arial,sans-serif", fontSize: 20, color: "#111111", fontWeight: 700, letterSpacing: 1 }}>NEW YORK &amp; 2ND CIRCUIT<br />APPELLATE DECISION DIGEST</div>
                    <div style={{ fontSize: 11, color: "#58595b", marginTop: 6 }}>{dateLabel}</div>
                  </div>
                  {courts.map(court => (
                    <div key={court}>
                      <div style={{ background: "#f5f5f5", padding: "6px 14px", fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: "#111111", borderLeft: "4px solid #ff8200" }}>
                        {court} ({byCourt[court].length})
                      </div>
                      {byCourt[court].map((c, i) => (
                        <div key={i} style={{ padding: "9px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 10, color: "#9ca3af", textTransform: "uppercase", marginBottom: 2 }}>{[c.docket, c.date].filter(Boolean).join(" · ")}</div>
                            <div style={{ fontFamily: "Georgia,serif", fontWeight: 700, fontSize: 14, color: "#111111" }}>{c.case_name}</div>
                            {summaries[c.docket || c.case_name]?.tags?.length > 0 && (
                              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 4 }}>
                                {summaries[c.docket || c.case_name].tags.map(tag => (
                                  <span key={tag} style={{ background: "#fff3e0", color: "#e65100", fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 10, letterSpacing: "0.5px" }}>{tag}</span>
                                ))}
                              </div>
                            )}
                            {summaries[c.docket || c.case_name]?.error && (
                              <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 4, fontStyle: "italic" }}>Unable to summarize</div>
                            )}
                            {summaries[c.docket || c.case_name]?.rateLimited && (
                              <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 4, fontStyle: "italic" }}>Rate limited — try again in a minute</div>
                            )}
                            {summaries[c.docket || c.case_name]?.case_summary && (
                              <div style={{ fontSize: 12, color: "#333333", marginTop: 4, lineHeight: 1.5, background: "#f8f4ff", borderLeft: "3px solid #ff8200", padding: "4px 8px", borderRadius: "0 4px 4px 0" }}>
                                <strong>Case:</strong> {summaries[c.docket || c.case_name].case_summary}
                              </div>
                            )}
                            {summaries[c.docket || c.case_name]?.decision_summary && (
                              <div style={{ fontSize: 12, color: "#333333", marginTop: 4, lineHeight: 1.5, background: "#fff8f0", borderLeft: "3px solid #ff8200", padding: "4px 8px", borderRadius: "0 4px 4px 0" }}>
                                <strong>Decision:</strong> {summaries[c.docket || c.case_name].decision_summary}
                              </div>
                            )}
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "flex-end", flexShrink: 0 }}>
                            {c.url && <a href={c.url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#111111", fontWeight: 600, textDecoration: "none" }}>View →</a>}
                            {c.pdf_url && <a href={c.pdf_url} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: "#ff8200", fontWeight: 600, textDecoration: "none" }}>PDF ↓</a>}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  <div style={{ background: "#f9fafb", padding: "10px 20px", textAlign: "center", fontSize: 10, color: "#9ca3af", borderTop: "1px solid #e5e7eb" }}>
                    {allDecisions.length} opinion{allDecisions.length !== 1 ? "s" : ""} · nycourts.gov &amp; ww3.ca2.uscourts.gov
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
                  <button onClick={() => setTab("send")} style={{ background: "#111111", color: "#fff", border: "none", borderRadius: 6, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Send →</button>
                </div>
              </>
            )}
          </>
        )}

        {tab === "send" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "20px" }}>
              <label style={{ display: "block", fontSize: 12, fontWeight: 700, color: "#333333", marginBottom: 5 }}>
                📬 RECIPIENTS <span style={{ fontWeight: 400, color: "#9ca3af" }}>(one per line or comma-separated)</span>
              </label>
              <textarea value={recipients} onChange={e => { setRecipients(e.target.value); localStorage.setItem("ny_recipients", e.target.value); }}
                placeholder={"partner1@firm.com\npartner2@firm.com"}
                style={{ width: "100%", height: 90, padding: "8px 10px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 13, resize: "vertical", fontFamily: "monospace", boxSizing: "border-box" }} />
            </div>

            <div style={{ background: "#fff", borderRadius: 10, border: "1px solid #e2e8f0", padding: "20px" }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#111111", marginBottom: 4 }}>Send Options</div>
              <div style={{ fontSize: 12, color: "#58595b", marginBottom: 16 }}>Copy HTML first, then open Gmail or Outlook to paste.</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>

                <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111111" }}>📋 Copy HTML to clipboard</div>
                    <div style={{ fontSize: 12, color: "#58595b", marginTop: 2 }}>Paste into Gmail, Outlook, or any HTML email editor.</div>
                  </div>
                  <button onClick={copyHTML} disabled={!emailHTML}
                    style={{ background: copied ? "#ff8200" : emailHTML ? "#111111" : "#9ca3af", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: emailHTML ? "pointer" : "not-allowed", whiteSpace: "nowrap", minWidth: 110 }}>
                    {copied ? "✅ Copied!" : "Copy HTML"}
                  </button>
                </div>

                <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111111" }}>📧 Copy + Open Gmail</div>
                    <div style={{ fontSize: 12, color: "#58595b", marginTop: 2 }}>Copies HTML then opens Gmail. In Gmail: click the <strong>⋯</strong> menu → <strong>"Paste as HTML"</strong> or switch to rich text and paste.</div>
                  </div>
                  <button onClick={openGmail} disabled={!emailHTML}
                    style={{ background: emailHTML ? "#ea4335" : "#9ca3af", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: emailHTML ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}>
                    Copy + Open Gmail
                  </button>
                </div>

                <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#111111" }}>📘 Copy + Open Outlook</div>
                    <div style={{ fontSize: 12, color: "#58595b", marginTop: 2 }}>Copies HTML then opens Outlook. In Outlook: click in the body and press <strong>Ctrl+V</strong> (or Cmd+V on Mac) to paste.</div>
                  </div>
                  <button onClick={openOutlook} disabled={!emailHTML}
                    style={{ background: emailHTML ? "#0078d4" : "#9ca3af", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: emailHTML ? "pointer" : "not-allowed", whiteSpace: "nowrap" }}>
                    Copy + Open Outlook
                  </button>
                </div>

                <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "14px 16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#111111" }}>🚀 Send via Resend</div>
                      <div style={{ fontSize: 12, color: "#58595b", marginTop: 2 }}>
                        One-click send — free tier includes 3,000 emails/month.
                      </div>
                      <div style={{ marginTop: 6, fontSize: 11, color: "#333333", lineHeight: 1.8, background: "#f8fafc", borderRadius: 6, padding: "6px 10px" }}>
                        Setup: sign up at <strong>resend.com</strong> → create API key → add <code style={{ background: "#e2e8f0", padding: "1px 4px", borderRadius: 3 }}>RESEND_API_KEY</code> to Vercel env vars. Optional: verify a domain and add <code style={{ background: "#e2e8f0", padding: "1px 4px", borderRadius: 3 }}>FROM_EMAIL</code> (e.g. <em>digest@yourdomain.com</em>) → redeploy.
                      </div>
                    </div>
                    <button onClick={sendViaResend} disabled={sendPhase === "sending" || !emailHTML}
                      style={{ background: !emailHTML ? "#9ca3af" : "#111111", color: "#fff", border: "none", borderRadius: 6, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: !emailHTML ? "not-allowed" : "pointer", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                      {sendPhase === "sending" ? <><Spinner size={12} /> Sending…</> : "Send Now"}
                    </button>
                  </div>
                  {sendResult && (
                    <div style={{ marginTop: 10, background: sendResult.ok ? "#f0fdf4" : "#fee2e2", border: "1px solid " + (sendResult.ok ? "#bbf7d0" : "#fca5a5"), borderRadius: 6, padding: "8px 12px", fontSize: 12, color: sendResult.ok ? "#ff8200" : "#b91c1c" }}>
                      {sendResult.ok ? "✅ " + sendResult.msg : "❌ " + sendResult.msg}
                    </div>
                  )}
                </div>

              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
