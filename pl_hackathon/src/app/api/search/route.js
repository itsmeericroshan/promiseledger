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
        `[${i+1}] ${r.title}\nURL: ${r.url}\nDate: ${r.published_date || 'recent'}\n${(r.content || '').slice(0, 600)}`
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
        max_tokens: 4000,
        messages: [{
          role: 'user',
          content: `You are WE — a political accountability AI. Real web search results are provided below. Analyse them and extract a complete picture.

QUERY: "${query}"

REAL WEB SEARCH RESULTS (found just now):
${searchContext || 'No specific results found, but use general knowledge if relevant.'}

Based on the above, you MUST determine a verdict even if evidence is partial — use "pending" or "partial" rather than "unknown" whenever there is ANY relevant information. Only use "unknown" if the search results are completely irrelevant to the query.

Respond with ONLY a raw JSON object. Do not use markdown code fences. Do not add any text before or after the JSON. The JSON must be complete and valid.

{
  "promise_text": "state the promise based on search results",
  "made_by": "who made it - infer from context if not explicit",
  "made_when": "year or date - infer if possible",
  "made_where": "place or event - infer if possible",
  "verdict": "fulfilled",
  "confidence": "high",
  "fulfillment_pct": 70,
  "sustainability_score": 65,
  "people_impact_score": 75,
  "current_status": "Write 3-4 sentences using SPECIFIC facts, numbers, names and dates found in the search results above.",
  "timeline": [
    {"year": "2024", "event": "specific event from search results"},
    {"year": "2026", "event": "latest update from search results"}
  ],
  "key_findings": [
    "specific fact 1 from the search results with numbers if available",
    "specific fact 2",
    "specific fact 3"
  ],
  "advantages": [
    "concrete benefit this brings to people if completed",
    "second benefit",
    "third benefit"
  ],
  "disadvantages": [
    "concrete risk, cost, or challenge",
    "second risk",
    "third risk"
  ],
  "people_impact": "1-2 sentences on how this directly affects ordinary citizens.",
  "sustainability": "1-2 sentences on long term viability based on what was found.",
  "expert_verdict": "Quote or paraphrase any opinion, criticism or analysis found in the search results.",
  "sources": [
    {"title": "exact title from search results", "snippet": "one sentence summary", "url": "exact url from search results", "date": "date if available", "credibility": "high"}
  ],
  "searched_on": "June 2026"
}

IMPORTANT RULES:
- confidence "high" if search results clearly relate to the query topic
- confidence "medium" if partially relevant
- confidence "low" ONLY if results are completely unrelated
- advantages and disadvantages must ALWAYS have at least 2 items each — think about general pros/cons of this type of policy even if search results don't explicitly state them
- Use the actual titles and URLs from the search results provided above for the sources array
- Never leave fulfillment_pct, sustainability_score, or people_impact_score as 0 unless there is truly zero information`
        }]
      }),
    });

    const claude = await claudeRes.json();
    const raw = (claude.content || []).filter(b => b.type === 'text').map(b => b.text).join('')

    let result = null
    try {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      // Try parsing the whole cleaned string first
      try {
        result = JSON.parse(cleaned)
      } catch {
        // Fallback: extract the largest {...} block
        const match = cleaned.match(/\{[\s\S]*\}/)
        if (match) result = JSON.parse(match[0])
      }
    } catch (e) {
      result = null
    }

    // Validate and fill missing fields rather than fully discarding
    if (!result || typeof result !== 'object') {
      result = {}
    }

    const hasUsefulSearchData = (tavily.results && tavily.results.length > 0) || tavily.answer

    result = {
      promise_text: result.promise_text || query,
      made_by: result.made_by || 'Not specified in available sources',
      made_when: result.made_when || 'Not specified',
      made_where: result.made_where || 'Not specified',
      verdict: result.verdict || (hasUsefulSearchData ? 'pending' : 'unknown'),
      confidence: result.confidence || (hasUsefulSearchData ? 'medium' : 'low'),
      fulfillment_pct: typeof result.fulfillment_pct === 'number' ? result.fulfillment_pct : (hasUsefulSearchData ? 40 : 0),
      sustainability_score: typeof result.sustainability_score === 'number' ? result.sustainability_score : (hasUsefulSearchData ? 50 : 0),
      people_impact_score: typeof result.people_impact_score === 'number' ? result.people_impact_score : (hasUsefulSearchData ? 50 : 0),
      current_status: result.current_status || tavily.answer || 'WE searched the web but could not find detailed information. Try rephrasing with more specific terms.',
      timeline: Array.isArray(result.timeline) ? result.timeline : [],
      key_findings: Array.isArray(result.key_findings) && result.key_findings.length ? result.key_findings :
        (tavily.results || []).slice(0, 3).map(r => r.title),
      advantages: Array.isArray(result.advantages) && result.advantages.length ? result.advantages :
        ['Could improve transparency and accountability if implemented well', 'May benefit the target group directly affected by this policy'],
      disadvantages: Array.isArray(result.disadvantages) && result.disadvantages.length ? result.disadvantages :
        ['Implementation may face budget or logistical constraints', 'Long-term sustainability depends on continued political will'],
      people_impact: result.people_impact || '',
      sustainability: result.sustainability || '',
      expert_verdict: result.expert_verdict || '',
      sources: Array.isArray(result.sources) && result.sources.length ? result.sources :
        (tavily.results || []).slice(0, 4).map(r => ({
          title: r.title,
          snippet: (r.content || '').slice(0, 150),
          url: r.url,
          date: r.published_date || '',
          credibility: 'medium'
        })),
      searched_on: result.searched_on || 'June 2026'
    }

    return Response.json(result)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
