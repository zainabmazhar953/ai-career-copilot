a
module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST for analysis." });
  }

  try {
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
      console.error("Missing GEMINI_API_KEY environment variable.");
      return res.status(500).json({
        error: "Gemini API key is missing. Configure GEMINI_API_KEY in Vercel."
      });
    }

    const body = req.body || {};
    const resume = body.resume;
    const jobDescription =
      body.jobDescription || body.jobDesc || body.job_description;

    if (
      typeof resume !== "string" ||
      typeof jobDescription !== "string" ||
      !resume.trim() ||
      !jobDescription.trim()
    ) {
      return res.status(400).json({
        error: "Please provide both resume and job description."
      });
    }

    const prompt = `
You are an expert resume reviewer and ATS specialist.

Compare the resume with the job description.
Return ONLY a valid JSON object with these fields:
{
  "ats_score": 75,
  "summary": "A concise assessment",
  "strengths": ["Strength 1", "Strength 2"],
  "missing_keywords": ["Keyword 1", "Keyword 2"],
  "improvements": ["Improvement 1", "Improvement 2"]
}

Rules:
- ats_score must be a number from 0 to 100.
- Identify real skills and keywords from the supplied text.
- Never invent qualifications or experience.
- Give specific, actionable recommendations.
- Return valid JSON only.

RESUME:
${resume}

JOB DESCRIPTION:
${jobDescription}
`;

    const response = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey
        },
        body: JSON.stringify({
          contents: [
            { parts: [{ text: prompt }] }
          ],
          generationConfig: {
            temperature: 0.2,
            responseMimeType: "application/json"
          }
        })
      }
    );

    const result = await response.json();

    if (!response.ok) {
      console.error(
        "Gemini API error:",
        response.status,
        JSON.stringify(result.error || result)
      );

      return res.status(502).json({
        error:
          result.error?.message ||
          "Gemini could not process the request. Check the API key and model access."
      });
    }

    const generatedText = result.candidates?.[0]?.content?.parts
      ?.map(part => part.text || "")
      .join("");

    if (!generatedText) {
      console.error("Gemini returned no text:", JSON.stringify(result));
      return res.status(502).json({
        error: "Gemini returned an empty response. Please try again."
      });
    }

    const cleaned = generatedText
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const analysis = JSON.parse(cleaned);

    if (
      typeof analysis.ats_score !== "number" ||
      !Array.isArray(analysis.strengths) ||
      !Array.isArray(analysis.missing_keywords) ||
      !Array.isArray(analysis.improvements) ||
      typeof analysis.summary !== "string"
    ) {
      throw new Error("Gemini returned an unexpected analysis format.");
    }

    analysis.ats_score = Math.max(
      0,
      Math.min(100, analysis.ats_score)
    );

    return res.status(200).json(analysis);
  } catch (error) {
    console.error("Resume analysis failed:", error);

    return res.status(500).json({
      error: error.message || "Unexpected server error."
    });
  }
};
