// Serverless NTP-style clock synchronization endpoint for Punjabi Beats Jam
export default function handler(req, res) {
  if (typeof res?.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type, x-publish-token');
  }

  if (req.method === 'OPTIONS') {
    if (typeof res?.setHeader === 'function') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
    }
    res.status(204);
    if (typeof res?.end === 'function') res.end();
    return;
  }

  const now = Date.now();
  res.status(200).json({
    t1: now,
    t2: now,
    serverNow: now,
  });
}

