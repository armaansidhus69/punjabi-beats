export default function handler(req, res) {
  if (typeof res?.setHeader === 'function') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
  }
  if (req.method === 'OPTIONS') {
    if (typeof res?.setHeader === 'function') {
      res.setHeader('Allow', 'GET, OPTIONS');
    }
    res.status(204);
    if (typeof res?.end === 'function') res.end();
    return;
  }
  res.status(200).json({
    status: "ok",
    message: "Punjabi Beats API is running",
    timestamp: new Date().toISOString()
  });
}
