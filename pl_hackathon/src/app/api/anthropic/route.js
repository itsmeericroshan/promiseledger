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

    // STEP 2: Claude analyses real search results — forces reasoning before JSON
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
          content: `You are WE, a rigorous political fact-checking analyst. Read the REAL web search results below about a specific promise or scheme.

QUERY: "${query}"

REAL WEB SEARCH RESULTS:
${searchContext || 'No results found.'}

STEP A — REASON FIRST (write this before the JSON):
In 2-3 sentences, state in plain words: (1) has this promise/scheme actually started or been launched according to the search results? (2) is it currently operating, helping people, or producing results? (3) based on that, what is the correct verdict?

Then write "###JSON###" on its own line, followed by ONLY the JSON object — no markdown fences.

CONSISTENCY RULE (critical): Your verdict, fulfillment_likelihood_pct, and current_status MUST all agree with each other and with your Step A reasoning.
- If your reasoning says the scheme HAS been launched/is operating/is helping people → verdict MUST be "fulfilled" or "partial", and fulfillment_likelihood_pct MUST be 65 or higher.
- If your reasoning says it was announced but NOT yet started → verdict is "pending", and fulfillment_likelihood_pct should reflect how likely it is to happen (could be anywhere 10-60 depending on evidence of momentum).
- If your reasoning says it failed, was cancelled, or deadline passed with nothing done → verdict is "broken", fulfillment_likelihood_pct should be low (0-25).
- NEVER write "launched" or "operating" or "has helped X people" in current_status and then mark verdict as "pending" — that is a contradiction and is forbidden.
- fulfillment_likelihood_pct and people_impact_score must be DIFFERENT numbers reflecting THIS specific case — never reuse 45/50 as filler. Pick numbers based on actual strength of evidence (e.g. a fully operational scheme with measurable results = 80-95; a scheme just announced with no action = 15-30).

For "sustainability_goal" — write 2-3 sentences on the actual long-term design of THIS scheme based on search results: is it a one-time announcement or an ongoing structure, does it build lasting capacity (training, infrastructure, institutions) or give a one-time benefit, can it scale. If search results don't mention this, reason about it based on the nature of the scheme itself (e.g. a task force with permanent staff is more sustainable than a one-time cash handout) — do not just say "not enough information."

JSON fields required:
{
  "promise_text": "concise statement of the actual promise/scheme",
  "made_by": "who is responsible — party, government, leader name from search results",
  "made_when": "year or date this started/was announced",
  "made_where": "context — state, country, or event",
  "verdict": "fulfilled",
  "confidence": "high",
  "fulfillment_likelihood_pct": 85,
  "people_impact_score": 70,
  "current_status": "3-4 sentences with SPECIFIC facts, names, numbers and dates from search results.",
  "sustainability_goal": "2-3 sentences on the actual long-term sustainability design of this specific scheme.",
  "timeline": [{"year": "2022", "event": "specific event"}, {"year": "2026", "event": "latest update"}],
  "key_findings": ["specific fact with numbers/names", "fact 2", "fact 3"],
  "advantages": ["specific benefit grounded in what the scheme actually does", "benefit 2", "benefit 3"],
  "disadvantages": ["specific risk or limitation grounded in the scheme's actual design", "risk 2", "risk 3"],
  "people_impact": "1-2 sentences on how this specifically affects the people it targets.",
  "expert_verdict": "Any opinion/criticism/analysis found in search results, or 'No independent expert commentary found in current search results.'",
  "sources": [{"title": "exact title", "snippet": "specific sentence with facts", "url": "exact url", "date": "date", "credibility": "high"}],
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
      // Split on the marker to isolate the JSON part from the reasoning prose
      let jsonPart = raw
      if (raw.includes('###JSON###')) {
        jsonPart = raw.split('###JSON###')[1] || raw
      }
      const cleaned = jsonPart.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim()
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

    // CONSISTENCY SAFETY NET: detect contradiction between current_status text and verdict
    const statusText = (result.current_status || '').toLowerCase()
    const fulfilledSignals = ['launched', 'has helped', 'have helped', 'cleared the exam', 'cleared exam', 'provides scholarships', 'since 20', 'implemented', 'operational', 'has been running', 'currently provides', 'has benefited', 'has supported', 'rolled out']
    const looksFulfilled = fulfilledSignals.some(sig => statusText.includes(sig))

    if (looksFulfilled && (result.verdict === 'pending' || !result.verdict)) {
      result.verdict = 'fulfilled'
      if (!result.fulfillment_likelihood_pct || result.fulfillment_likelihood_pct < 65) {
        result.fulfillment_likelihood_pct = 80
      }
      if (!result.confidence || result.confidence === 'low') {
        result.confidence = 'high'
      }
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
