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
        query: query + ' latest news status update result',
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
        `[${i+1}] ${r.title}\nURL: ${r.url}\nDate: ${r.published_date || 'recent'}\n${(r.content || '').slice(0, 800)}`
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
          content: `You are WE, a rigorous political fact-checking analyst. Read the REAL web search results below about a specific promise or scheme, then respond with ONLY a single JSON object — no reasoning text, no markdown fences, no commentary before or after. Your entire response must be valid JSON starting with { and ending with }.

QUERY: "${query}"

REAL WEB SEARCH RESULTS:
${searchContext || 'No results found.'}

RULES FOR ACCURATE ANALYSIS:
- Read the search results carefully. If they describe the scheme as already launched, operating, helping people, or producing measurable results (e.g. "X candidates succeeded", "has provided", "since 2022", "rolled out", "implemented") then verdict MUST be "fulfilled" or "partial" — NOT "pending".
- Only use "pending" if the scheme was announced but search results show no evidence it has started.
- Only use "broken" if search results explicitly mention cancellation, failure, or missed deadlines with no action.
- fulfillment_likelihood_pct and people_impact_score MUST be specific numbers based on the actual evidence strength for THIS case — never default to round numbers like 45 or 50. A scheme with strong measurable results should score 75-95. A scheme with no action should score 10-30.
- current_status, key_findings, advantages, disadvantages must all reference specific facts, names, or numbers from the search results — never generic filler text.
- sustainability_goal: write 2-3 sentences on whether this is a one-time benefit or builds lasting capacity/institutions, based on the scheme's actual design.

Return ONLY this JSON structure with real values filled in:
{"promise_text":"...","made_by":"...","made_when":"...","made_where":"...","verdict":"fulfilled","confidence":"high","fulfillment_likelihood_pct":80,"people_impact_score":70,"current_status":"...","sustainability_goal":"...","timeline":[{"year":"2022","event":"..."}],"key_findings":["...","...","..."],"advantages":["...","...","..."],"disadvantages":["...","...","..."],"people_impact":"...","expert_verdict":"...","sources":[{"title":"...","snippet":"...","url":"...","date":"...","credibility":"high"}],"searched_on":"latest available data"}`
        }]
      }),
    });

    const claude = await claudeRes.json();
    const raw = (claude.content || []).filter(b => b.type === 'text').map(b => b.text).join('')

    let result = null
    let parseError = ''
    try {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      try {
        result = JSON.parse(cleaned)
      } catch (e1) {
        const matches = cleaned.match(/\{[\s\S]*\}/g)
        if (matches && matches.length) {
          result = JSON.parse(matches[matches.length - 1])
        }
      }
    } catch (e) {
      parseError = e.message
      result = null
    }

    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      result = { _parse_failed: true, _raw_preview: raw.slice(0, 300), _error: parseError }
    }

    const hasUsefulSearchData = (tavily.results && tavily.results.length > 0) || tavily.answer

    // Establish the confirmed status text first (this is what Pass 2 will judge)
    const confirmedStatusText = result.current_status || (result._parse_failed ? raw.slice(0, 500) : (tavily.answer || ''))

    // PASS 2: Isolated verdict + scoring decision, based ONLY on the confirmed status text.
    // This guarantees consistency because the AI is judging its own already-written summary,
    // not generating a fresh independent guess that can contradict it.
    let verdictDecision = null
    if (confirmedStatusText && confirmedStatusText.length > 20) {
      try {
        const verdictRes = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': anthropicKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-20250514',
            max_tokens: 300,
            messages: [{
              role: 'user',
              content: `Read this status description of a political promise/scheme:

"${confirmedStatusText}"

Based ONLY on what this text says, answer with ONLY a JSON object, nothing else:
{"verdict":"fulfilled","confidence":"high","fulfillment_likelihood_pct":85,"people_impact_score":70}

RULES:
- If the text describes the scheme as already happening, helping people, producing results, having measurable success, or operating (any tense showing it IS active or HAS worked) -> verdict is "fulfilled" or "partial", fulfillment_likelihood_pct must be 70-95.
- If the text describes only an announcement or plan with no evidence of action -> verdict is "pending", fulfillment_likelihood_pct should be 15-50 based on how concrete the plan sounds.
- If the text describes failure, cancellation, or a missed deadline -> verdict is "broken", fulfillment_likelihood_pct should be 0-20.
- If the text is empty or unrelated -> verdict is "unknown", fulfillment_likelihood_pct is 0.
- confidence is "high" if the text gives clear specific evidence either way, "medium" if somewhat clear, "low" if vague.
- people_impact_score (0-100) should reflect how much this affects ordinary people's daily lives based on the text — a scheme with no description of who it affects scores lower than one explicitly creating jobs, providing money, or safety etc.

Respond with ONLY the JSON object.`
            }]
          }),
        })
        const verdictData = await verdictRes.json()
        const verdictRaw = (verdictData.content || []).filter(b => b.type === 'text').map(b => b.text).join('')
        const cleaned2 = verdictRaw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
        const match2 = cleaned2.match(/\{[\s\S]*\}/)
        if (match2) verdictDecision = JSON.parse(match2[0])
      } catch (e) {
        verdictDecision = null
      }
    }

    // Apply Pass 2's decision — this OVERRIDES Pass 1's verdict/scores since Pass 2
    // is judging the confirmed, already-written text and cannot contradict it.
    if (verdictDecision && verdictDecision.verdict) {
      result.verdict = verdictDecision.verdict
      result.confidence = verdictDecision.confidence || result.confidence
      result.fulfillment_likelihood_pct = typeof verdictDecision.fulfillment_likelihood_pct === 'number' ? verdictDecision.fulfillment_likelihood_pct : result.fulfillment_likelihood_pct
      result.people_impact_score = typeof verdictDecision.people_impact_score === 'number' ? verdictDecision.people_impact_score : result.people_impact_score
    }

    result = {
      promise_text: result.promise_text || query,
      made_by: result.made_by || 'Not specified in available sources',
      made_when: result.made_when || 'Not specified',
      made_where: result.made_where || 'Not specified',
      verdict: result.verdict || (hasUsefulSearchData ? 'pending' : 'unknown'),
      confidence: result.confidence || (hasUsefulSearchData ? 'medium' : 'low'),
      fulfillment_likelihood_pct: typeof result.fulfillment_likelihood_pct === 'number' ? result.fulfillment_likelihood_pct : (hasUsefulSearchData ? 35 : 0),
      people_impact_score: typeof result.people_impact_score === 'number' ? result.people_impact_score : (hasUsefulSearchData ? 40 : 0),
      current_status: confirmedStatusText || 'WE searched the web but could not find detailed information. Try rephrasing with more specific terms.',
      sustainability_goal: result.sustainability_goal || 'Not enough information was found to assess the long-term sustainability design of this scheme.',
      timeline: Array.isArray(result.timeline) ? result.timeline : [],
      key_findings: Array.isArray(result.key_findings) && result.key_findings.length ? result.key_findings :
        (tavily.results || []).slice(0, 3).map(r => r.title),
      advantages: Array.isArray(result.advantages) && result.advantages.length ? result.advantages : [],
      disadvantages: Array.isArray(result.disadvantages) && result.disadvantages.length ? result.disadvantages : [],
      people_impact: result.people_impact || '',
      expert_verdict: result.expert_verdict || '',
      sources: Array.isArray(result.sources) && result.sources.length ? result.sources :
        (tavily.results || []).slice(0, 4).map(r => ({
          title: r.title,
          snippet: (r.content || '').slice(0, 150),
          url: r.url,
          date: r.published_date || '',
          credibility: 'medium'
        })),
      searched_on: result.searched_on || 'latest available data',
      _debug_parse_failed: result._parse_failed || false
    }

    return Response.json(result)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
