export async function POST(request) {
  const tavilyKey = process.env.TAVILY_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;

  if (!tavilyKey || !anthropicKey) {
    return Response.json({ error: 'API keys not configured.' }, { status: 503 });
  }

  try {
    const { query } = await request.json();

    // STEP 1: Tavily search — real-time web results instantly
    const tavilyRes = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: tavilyKey,
        query: query + ' latest news 2025 2026',
        search_depth: 'advanced',
        include_answer: true,
        include_raw_content: false,
        max_results: 8,
      }),
    });

    const tavily = await tavilyRes.json();

    const searchContext = [
      tavily.answer ? `Web Summary: ${tavily.answer}` : '',
      ...(tavily.results || []).map((r, i) =>
        `[${i+1}] ${r.title}\nURL: ${r.url}\nDate: ${r.published_date || 'recent'}\n${r.content}`
      )
    ].filter(Boolean).join('\n\n---\n\n')

    // STEP 2: Claude analyses real search results
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2500,
        messages: [{
          role: 'user',
          content: `You are WE — a political accountability AI. Analyse this using ONLY the real search results below.

QUERY: "${query}"

REAL WEB SEARCH RESULTS:
${searchContext || 'No results found.'}

Respond with ONLY a JSON object, no extra text:
{
  "promise_text": "the promise as found",
  "made_by": "name and party",
  "made_when": "date/year",
  "made_where": "place/event",
  "verdict": "fulfilled or broken or pending or partial or unknown",
  "confidence": "high or medium or low",
  "fulfillment_pct": 70,
  "sustainability_score": 65,
  "people_impact_score": 75,
  "current_status": "3-4 sentences with specific facts and dates from the search results",
  "timeline": [{"year": "2020", "event": "what happened"}, {"year": "2025", "event": "latest"}],
  "key_findings": ["finding with data", "finding 2", "finding 3", "finding 4"],
  "advantages": ["benefit 1", "benefit 2", "benefit 3"],
  "disadvantages": ["risk 1", "risk 2", "risk 3"],
  "people_impact": "How this affects ordinary people daily.",
  "sustainability": "Long term viability assessment.",
  "expert_verdict": "What analysts or fact-checkers say.",
  "sources": [{"title": "title", "snippet": "snippet", "url": "url", "date": "date", "credibility": "high"}],
  "searched_on": "June 2026"
}`
        }]
      }),
    });

    const claude = await claudeRes.json();
    const raw = (claude.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
    const match = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim().match(/\{[\s\S]*\}/)

    let result
    try {
      result = match ? JSON.parse(match[0]) : null
      if (!result?.verdict) throw new Error('bad json')
    } catch {
      result = {
        verdict: 'unknown', confidence: 'low',
        fulfillment_pct: 0, sustainability_score: 0, people_impact_score: 0,
        promise_text: query, made_by: 'Unknown', made_when: 'Unknown', made_where: 'Unknown',
        current_status: tavily.answer || 'Could not find enough information. Try a more specific query.',
        timeline: [], key_findings: [], advantages: [], disadvantages: [],
        people_impact: '', sustainability: '', expert_verdict: '',
        sources: (tavily.results || []).slice(0, 3).map(r => ({
          title: r.title, snippet: r.content?.slice(0, 150) || '',
          url: r.url, date: r.published_date || '', credibility: 'medium'
        })),
        searched_on: 'June 2026'
      }
    }

    return Response.json(result)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
