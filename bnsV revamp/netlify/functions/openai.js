export async function handler(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: corsHeaders(),
    };
  }

  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      headers: corsHeaders(),
      body: 'Method Not Allowed',
    };
  }

  try {
    const body = JSON.parse(event.body || '{}');

    const endpoint = typeof body.endpoint === 'string'
      ? (body.endpoint.startsWith('/') ? body.endpoint : `/${body.endpoint}`)
      : '/v1/responses';

    const payload = body.payload ?? body;
    if (!payload) {
      throw new Error('Missing payload');
    }

    const response = await fetch(`https://api.openai.com${endpoint}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const headers = {
      ...corsHeaders(),
      'Content-Type': response.headers.get('content-type') || 'application/json',
    };

    return {
      statusCode: response.status,
      headers,
      body: await response.text(),
    };
  } catch (err) {
    return {
      statusCode: 400,
      headers: {
        ...corsHeaders(),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ error: err.message }),
    };
  }
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

