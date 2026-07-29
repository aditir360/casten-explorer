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
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({ error: "Gemini API error", detail: errText }), {
        status: 502,
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
      return new Response(JSON.stringify({ error: "Model returned non-JSON output", raw }), {
        status: 502,
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
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
