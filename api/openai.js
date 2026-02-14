export default async function handler(req, res) {
    if (req.method !== 'POST') {
      res.status(405).json({ error: { message: 'Method not allowed' } });
      return;
    }
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      res.status(500).json({ error: { message: 'OPENAI_API_KEY not configured on server' } });
      return;
    }
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
      const resp = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + key
        },
        body: JSON.stringify(body)
      });
      const data = await resp.json();
      res.status(resp.status).json(data);
    } catch (err) {
      res.status(500).json({ error: { message: err.message || 'Proxy error' } });
    }
  }