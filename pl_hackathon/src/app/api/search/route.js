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

    // STEP 2: Claude analyses real search results — much stricter, case-specific prompt
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
          content: `You are WE, a rigorous political fact-checking analyst. You will be given REAL web search results about a specific promise or scheme. Your job is to carefully READ them and report the ACTUAL facts found — not a generic template answer.

QUERY: "${query}"

REAL WEB SEARCH RESULTS:
${searchContext || 'No results found.'}

CRITICAL INSTRUCTIONS — READ CAREFULLY:
1. Actually read the search results above word by word before answering.
2. If the search results describe the scheme/promise as already operating, helping people, producing results, or being implemented — the verdict MUST be "fulfilled" or "partial", NOT "pending". Look for evidence words like "launched", "implemented", "selected candidates cleared exam", "scheme provides", "has helped", "since 2022/2023" etc — these indicate it IS happening, so do not call it pending.
3. Only use "pending" if the search results describe something announced/promised but not yet started, or still "under process"/"will be formed".
4. Only use "broken" if search results explicitly mention failure, cancellation, or the deadline passing with no action.
5. Your fulfillment_likelihood_pct, people_impact_score must be SPECIFIC to this case — vary them based on actual evidence strength. Do not default to 40/50/50.
6. Your key_findings, advantages, and disadvantages must reference SPECIFIC details from the search results (names, numbers, dates) — never generic boilerplate like "may face budget constraints" unless the search results actually say that.
7. For "sustainability_goal" — do NOT give a score. Instead write 2-3 sentences explaining what the sustainability/long-term goal of this specific scheme is, based on its actual design and purpose found in search results — e.g. is it a one-time scheme or recurring, does it build lasting capability or give a one-time benefit, is it scalable.

Respond with ONLY a raw JSON object. No markdown fences, no extra text.

{
  "promise_text": "concise statement of the actual promise/scheme",
  "made_by": "who is responsible — be specific (party, government, leader name) based on search results",
  "made_when": "year or date this started/was announced, from search results",
  "made_where": "context — state, country, or event",
  "verdict": "fulfilled",
  "confidence": "high",
  "fulfillment_likelihood_pct": 85,
  "people_impact_score": 70,
  "current_status": "3-4 sentences with SPECIFIC facts, names, numbers and dates taken directly from the search results.",
  "sustainability_goal": "2-3 sentences explaining the actual long-term sustainability design/goal of this specific scheme based on what was found — is it ongoing, scalable, one-time, building capacity etc.",
  "timeline": [
    {"year": "2022", "event": "specific event from search results"},
    {"year": "2026", "event": "latest specific update from search results"}
  ],
  "key_findings": [
    "specific fact with numbers/names from search results",
    "specific fact 2",
    "specific fact 3"
  ],
  "advantages": [
    "specific benefit this scheme/promise gives, grounded in what it actually does",
    "specific benefit 2",
    "specific benefit 3"
  ],
  "disadvantages": [
    "specific risk or limitation grounded in the actual scheme design or search results",
    "specific risk 2",
    "specific risk 3"
  ],
  "people_impact": "1-2 sentences on how this specifically affects the people it targets, using details from search results.",
  "expert_verdict": "Any opinion, criticism, or analysis mentioned in the search results — quote or paraphrase. If none found, say 'No independent expert commentary found in current search results.'",
  "sources": [
    {"title": "exact title from search results", "snippet": "one specific sentence with facts from that source", "url": "exact url from search results", "date": "date if available", "credibility": "high"}
  ],
  "searched_on": "latest available data"
}

Verdict options: fulfilled, partial, pending, broken, unknown
Confidence: high (clear specific evidence), medium (some evidence), low (vague/unrelated)`
        }]
      }),
    });

    const claude = await claudeRes.json();
    const raw = (claude.content || []).filter(b => b.type === 'text').map(b => b.text).join('')

    let result = null
    try {
      const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
      try {
        result = JSON.parse(cleaned)
      } catch {
        const match = cleaned.match(/\{[\s\S]*\}/)
        if (match) result = JSON.parse(match[0])
      }
    } catch (e) {
      result = null
    }

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
      fulfillment_likelihood_pct: typeof result.fulfillment_likelihood_pct === 'number' ? result.fulfillment_likelihood_pct : (hasUsefulSearchData ? 45 : 0),
      people_impact_score: typeof result.people_impact_score === 'number' ? result.people_impact_score : (hasUsefulSearchData ? 50 : 0),
      current_status: result.current_status || tavily.answer || 'WE searched the web but could not find detailed information. Try rephrasing with more specific terms.',
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
      searched_on: result.searched_on || 'latest available data'
    }

    return Response.json(result)
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 })
  }
}
