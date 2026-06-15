export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return Response.json({ error: 'ANTHROPIC_API_KEY not configured.' }, { status: 503 });
  }

  try {
    const body = await request.json();
    const headers = {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
    };

    let messages = [...(body.messages || [])];
    const maxIter = 8;
    let iter = 0;
    let lastData = null;
    let allContent = [];

    while (iter < maxIter) {
      iter++;
      const payload = {
        model: body.model || 'claude-sonnet-4-20250514',
        max_tokens: body.max_tokens || 3000,
        ...(body.system ? { system: body.system } : {}),
        messages,
        ...(body.tools && body.tools.length > 0 ? { tools: body.tools } : {}),
      };

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (!res.ok) return Response.json(data, { status: res.status });

      lastData = data;
      // Collect all content blocks across iterations
      if (data.content) allContent = [...allContent, ...data.content];

      // If done, break
      if (data.stop_reason === 'end_turn' || data.stop_reason === 'stop_sequence') break;

      // If tool_use, continue the loop
      const toolUseBlocks = (data.content || []).filter(b => b.type === 'tool_use');
      if (toolUseBlocks.length === 0) break;

      // Add assistant turn
      messages = [...messages, { role: 'assistant', content: data.content }];

      // Add tool results — for web_search Anthropic handles results automatically
      // We just need to pass back empty tool_result to continue
      const toolResults = toolUseBlocks.map(b => ({
        type: 'tool_result',
        tool_use_id: b.id,
        content: 'Search completed.',
      }));
      messages = [...messages, { role: 'user', content: toolResults }];
    }

    // Return last response but with ALL collected content
    return Response.json({ ...lastData, content: allContent });
  } catch (err) {
    return Response.json({ error: err.message }, { status: 500 });
  }
}
