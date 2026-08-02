// Supabase Edge Function: analyze-message
//
// Deploy with:
//   supabase functions deploy analyze-message
// Set the secret it needs with:
//   supabase secrets set GEMINI_API_KEY=your-key-here
//
// This is the ONLY place your Gemini API key ever lives. scan.html calls
// this function over HTTPS and never sees the key itself.

const SYSTEM_PROMPT = `You are the phishing/scam detection engine behind a consumer cybersecurity product called Casten. A user has submitted a message, email, text, or link they think might be a scam or phishing attempt. Analyze it and assess the risk.

Look for: urgency/pressure tactics, requests for money or gift cards, requests for passwords or personal/financial info, mismatched or suspicious sender/domain, impersonation of a real company, government agency, or person, poor grammar inconsistent with the claimed sender, links that don't match the claimed destination, threats, too-good-to-be-true offers, romance/relationship manipulation, tech-support scare tactics.

Respond with ONLY valid JSON, no markdown fences, no commentary, in exactly this shape:
{
  "risk_score": <integer 0-100>,
  "confidence": <integer 0-100, how confident you are in this assessment>,
  "threat_type": "<short label, e.g. 'Phishing', 'Gift card scam', 'Government impersonation', 'None detected'>",
  "summary": "<one sentence describing what this message is doing>",
  "red_flags": [<short string>, ...],
  "recommended_action": "<one or two plain-English sentences telling the person what to do next>"
}

If the input is empty, unrelated, or clearly harmless, return a low risk_score, threat_type "None detected", and say so in recommended_action. Return ONLY the JSON object, nothing else.`;


// ── Hardcoded fallback analyser ───────────────────────────────────────────────
// Used when Gemini is unavailable (high load, quota exceeded, network error).
// Covers the most common real-world scam patterns with weighted signal scoring.

interface AnalysisResult {
  risk_score: number;
  confidence: number;
  threat_type: string;
  summary: string;
  red_flags: string[];
  recommended_action: string;
}

function fallbackAnalyse(text: string): AnalysisResult {
  const t = text.toLowerCase();

  const signals: Array<{ pattern: RegExp; flag: string; weight: number; type: string }> = [
    // Urgency / pressure
    { pattern: /urgent|immediately|act now|expires? in|within 24|48 hours?|limited time|last chance|final notice/i, flag: "Urgency language detected", weight: 18, type: "Phishing" },
    { pattern: /your account (has been|will be|is) (suspended|limited|locked|closed|terminated)/i, flag: "Account suspension threat", weight: 22, type: "Phishing" },
    { pattern: /will be (arrested|prosecuted|charged|sued)|warrant (has been|will be) issued/i, flag: "Legal threat tactic", weight: 25, type: "Government impersonation" },

    // Credential / data harvesting
    { pattern: /verify your (identity|account|information|details|card)|confirm your (password|ssn|social security|pin|card number)/i, flag: "Credential harvesting request", weight: 24, type: "Phishing" },
    { pattern: /social security|ssn|medicare (number|id|card)|date of birth.*card|card.*date of birth/i, flag: "Sensitive personal data request", weight: 26, type: "Identity theft" },
    { pattern: /password|pin number|security code|cvv|card number/i, flag: "Financial credential request", weight: 22, type: "Phishing" },

    // Payment scams
    { pattern: /gift card|itunes card|google play card|steam card|amazon card/i, flag: "Gift card payment demand", weight: 30, type: "Gift card scam" },
    { pattern: /wire transfer|western union|moneygram|zelle|cashapp|venmo.*urgent/i, flag: "Unusual payment method requested", weight: 26, type: "Payment fraud" },
    { pattern: /bitcoin|crypto|usdt|ethereum.*send|transfer.*wallet/i, flag: "Cryptocurrency payment demand", weight: 24, type: "Crypto scam" },
    { pattern: /processing fee|release fee|customs fee|pay.*to (claim|receive|unlock)/i, flag: "Advance fee demand", weight: 28, type: "Advance fee fraud" },

    // Lookalike domains / suspicious links
    { pattern: /https?:\/\/[^\s]*[-_](secure|verify|login|update|alert|support|account)[^\s]*/i, flag: "Suspicious lookalike URL", weight: 20, type: "Phishing" },
    { pattern: /amaz[0o]n|paypa[l1]|micros[0o]ft|app[l1]e|g[0o]{2}gle|faceb[0o]{2}k|netfl[i1]x/i, flag: "Brand impersonation in URL or text", weight: 24, type: "Brand impersonation" },
    { pattern: /bit\.ly|tinyurl|t\.co\/(?!twitter)|goo\.gl|ow\.ly/i, flag: "Shortened URL hiding destination", weight: 14, type: "Phishing" },

    // Government impersonation
    { pattern: /irs|internal revenue|tax (refund|debt|owed)|federal (bureau|agent|warrant)|social security administration/i, flag: "Government agency impersonation", weight: 22, type: "Government impersonation" },
    { pattern: /customs|border (patrol|protection)|package (held|detained)|parcel.*fee/i, flag: "Customs / parcel scam pattern", weight: 18, type: "Delivery scam" },

    // Tech support
    { pattern: /your (computer|pc|device|mac) (is infected|has (a )?virus|has been hacked|is at risk)/i, flag: "Fake virus / security alert", weight: 24, type: "Tech support scam" },
    { pattern: /call (microsoft|apple|google|amazon|norton|mcafee) (support|helpline|immediately)/i, flag: "Fake tech support call request", weight: 26, type: "Tech support scam" },

    // Romance / relationship
    { pattern: /i (love|miss) you.*money|send.*money.*love|relationship.*investment|met (online|dating)/i, flag: "Romance scam pattern", weight: 20, type: "Romance scam" },

    // Family emergency
    { pattern: /(grandson|granddaughter|son|daughter|nephew|niece).*accident|arrested.*bail|hospital.*money.*don.t tell/i, flag: "Family emergency scam", weight: 28, type: "Grandparent scam" },
    { pattern: /don.t (tell|call|mention) (mom|dad|your (parents?|family|spouse|husband|wife))/i, flag: "Secrecy request (major red flag)", weight: 22, type: "Grandparent scam" },

    // Investment
    { pattern: /guaranteed (returns?|profit|income)|risk.?free investment|double your (money|investment)/i, flag: "Guaranteed return claim", weight: 24, type: "Investment fraud" },
    { pattern: /crypto.*platform.*returns?|exclusive.*investment.*opportunity|limited.*investor.*spots?/i, flag: "Fake investment opportunity", weight: 22, type: "Pig butchering / investment fraud" },

    // Prize / lottery
    { pattern: /you (have won|are a winner|have been selected|are eligible)/i, flag: "Prize / lottery claim", weight: 16, type: "Lottery scam" },
    { pattern: /claim your (prize|reward|gift|winnings)|congratulations.*selected/i, flag: "Unsolicited prize claim", weight: 18, type: "Lottery scam" },
  ];

  const hits = signals.filter(s => s.pattern.test(t));
  const totalWeight = hits.reduce((sum, s) => sum + s.weight, 0);
  const risk_score = Math.min(97, totalWeight);

  // Dominant threat type
  const typeCounts: Record<string, number> = {};
  hits.forEach(h => { typeCounts[h.type] = (typeCounts[h.type] ?? 0) + h.weight; });
  const dominantType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "None detected";

  const red_flags = hits.map(h => h.flag);

  let summary = "";
  let recommended_action = "";

  if (risk_score === 0) {
    summary = "No obvious scam signals were detected in this message.";
    recommended_action = "This message appears low risk, but always verify unexpected requests through official contact methods before taking action.";
  } else if (risk_score < 30) {
    summary = `This message contains minor suspicious signals (${red_flags[0] ?? "unusual phrasing"}).`;
    recommended_action = "Proceed with caution. Verify the sender through official channels before responding or clicking any links.";
  } else if (risk_score < 60) {
    summary = `This message shows multiple characteristics of a ${dominantType.toLowerCase()} attempt.`;
    recommended_action = "Do not click links or provide any information. Verify the sender independently using official contact details found on the company's real website.";
  } else {
    summary = `This message strongly matches patterns of a ${dominantType.toLowerCase()} attack, with ${hits.length} red flag${hits.length !== 1 ? "s" : ""} detected.`;
    recommended_action = "Do not respond, click any links, or provide any information. Delete this message immediately. If it impersonates a real organisation, report it directly through that organisation's official website.";
  }

  return {
    risk_score,
    confidence: hits.length > 0 ? Math.min(88, 55 + hits.length * 6) : 70,
    threat_type: risk_score === 0 ? "None detected" : dominantType,
    summary,
    red_flags,
    recommended_action,
  };
}

Deno.serve(async (req: Request) => {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { text } = await req.json();

    if (!text || typeof text !== "string" || !text.trim()) {
      return new Response(JSON.stringify({ error: "Missing 'text' in request body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Server is missing GEMINI_API_KEY" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [{ text: `${SYSTEM_PROMPT}\n\nMessage to analyze:\n"""${text.slice(0, 4000)}"""` }],
            },
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!geminiRes.ok) {
      // Gemini unavailable (high load, quota, etc.) — use hardcoded fallback
      const fallback = fallbackAnalyse(text);
      return new Response(JSON.stringify({ ...fallback, _source: "fallback" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await geminiRes.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
    const cleaned = raw.replace(/```json|```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Model returned malformed JSON — use fallback
      const fallback = fallbackAnalyse(text);
      return new Response(JSON.stringify({ ...fallback, _source: "fallback" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Basic shape guard so a malformed model response can't break the UI
    const safe = {
      risk_score: Number.isFinite(parsed.risk_score) ? Math.max(0, Math.min(100, parsed.risk_score)) : 0,
      confidence: Number.isFinite(parsed.confidence) ? Math.max(0, Math.min(100, parsed.confidence)) : 50,
      threat_type: typeof parsed.threat_type === "string" ? parsed.threat_type : "Unknown",
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags.filter((f: unknown) => typeof f === "string") : [],
      recommended_action: typeof parsed.recommended_action === "string" ? parsed.recommended_action : "",
    };

    return new Response(JSON.stringify(safe), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    // Unexpected error — attempt fallback if we can extract text from the request
    try {
      const body = await req.clone().json().catch(() => ({}));
      const txt = typeof body?.text === "string" ? body.text : "";
      if (txt) {
        const fallback = fallbackAnalyse(txt);
        return new Response(JSON.stringify({ ...fallback, _source: "fallback" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch { /* ignore */ }
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
