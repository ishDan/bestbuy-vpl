const Groq = require('groq-sdk')

const client = new Groq({ apiKey: process.env.GROQ_API_KEY })

const SPEC_SCHEMA = `Return ONLY a JSON object with exactly these keys (no extras). Use null for unknown/not applicable.

{
  "Display Type": "<string or null>",
  "Screen Size": "<string or null>",
  "Screen Material": "<string or null>",
  "Case Size": "<string or null>",
  "Case Material": "<string or null>",
  "Built-in Storage": "<string or null>",
  "Built-in GPS": "<string or null — describe GPS capability, e.g. 'Yes (multi-band)', 'No', 'Connected GPS via phone'>",
  "Max Water Resistance": "<string or null>",
  "Usage Time (Battery)": "<string or null>",
  "Wireless Connectivity": "<string or null>",
  "Voice Assistant": "<string or null>",
  "Sensors": "<string or null>",
  "Metrics Measured": "<string or null>",
  "US Release Date": "<string or null>"
}

Be specific with text values. For "Sensors" and "Metrics Measured", return comma-separated lists. For "US Release Date" use YYYY-MM-DD format.`

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { name, brand, model, variant, size } = req.body
  if (!name && !model) return res.status(400).json({ error: 'product name required' })

  const productLabel = [brand, model, variant, size].filter(Boolean).join(' ')

  const systemPrompt =
    'You are a product spec lookup assistant. You have web search; use it to find the official manufacturer spec sheet and recent reviews for the requested product. Return only valid JSON, no markdown, no explanation. Prefer filling fields with concrete values over null whenever the spec sheet, a credible review, or a retailer listing mentions the spec.'

  const userPrompt = `Search the web for the official specs of the ${productLabel}.
Look at the manufacturer's product page first, then trusted retailers (Best Buy, Amazon) and major reviews if needed.
This may be a recently released product; do not refuse to look it up just because it's new.

${SPEC_SCHEMA}

Product: ${productLabel}
Return ONLY the JSON object, no markdown, no explanation.`

  const callModel = (modelId) =>
    client.chat.completions.create({
      model: modelId,
      max_tokens: 1536,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })

  try {
    // First-line: full compound-beta (deepest web search). Fall back to mini
    // (still has search) on rate limit/size issues, then to llama (no search)
    // as a last resort if both web-search models fail entirely.
    let response
    if (req.body.noSearch) {
      response = await callModel('llama-3.3-70b-versatile')
    } else {
      try {
        response = await callModel('compound-beta')
      } catch (e1) {
        console.warn('compound-beta failed, trying compound-beta-mini:', e1.message)
        try {
          response = await callModel('compound-beta-mini')
        } catch (e2) {
          console.warn('compound-beta-mini failed, falling back to llama-3.3-70b-versatile:', e2.message)
          response = await callModel('llama-3.3-70b-versatile')
        }
      }
    }

    const raw = response.choices[0]?.message?.content?.trim() ?? ''
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim()
    const specs = JSON.parse(jsonStr)

    return res.status(200).json({ specs })
  } catch (err) {
    console.error('fetch-specs error:', err)
    return res.status(500).json({ error: err.message })
  }
}
