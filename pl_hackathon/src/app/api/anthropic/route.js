export async function POST(request) {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    return Response.json({
      error: 'API key not configured',
      message: 'ANTHROPIC_API_KEY is not set. Please add it to your .env.local file (local) or Vercel environment variables (deployed).',
      setup: 'See README.md for instructions.'
    }, { status: 503 });
  }

  try {
    const body = await request.json();
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05',
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return Response.json(data, { status: response.status });
  } catch (err) {
    return Response.json({
      error: 'Request failed',
      message: err.message
    }, { status: 500 });
  }
}
