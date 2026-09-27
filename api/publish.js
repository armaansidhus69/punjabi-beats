// api/publish.js — Vercel serverless function
// Frontend se direct Apinator publish nahi kar sakte (secrets expose ho jayenge),
// isliye ye proxy function secrets ko server-side rakh kar publish karta hai.
import { Apinator } from '@apinator/server';

const realtime = new Apinator({
  appId: process.env.APINATOR_APP_ID,
  key: process.env.APINATOR_KEY,
  secret: process.env.APINATOR_SECRET,
  cluster: process.env.APINATOR_CLUSTER ?? 'eu', // EXPO_PUBLIC_APINATOR_CLUSTER se match rakho
});

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Env vars missing ho toh clear error do (silent 500 se bachne ke liye)
  if (!process.env.APINATOR_APP_ID || !process.env.APINATOR_KEY || !process.env.APINATOR_SECRET) {
    return res.status(500).json({ error: 'Apinator env vars set nahi hain (APINATOR_APP_ID, APINATOR_KEY, APINATOR_SECRET)' });
  }

  const { channel, event, data } = req.body || {};

  if (!channel || !event || data == null) {
    return res.status(400).json({ error: 'Missing fields: channel, event, data' });
  }

  try {
    await realtime.trigger({
      name: event,
      channel: channel,
      // SDK docs: data = JSON string chahiye. Client string bhejta hai; object aaya toh normalize.
      data: typeof data === 'string' ? data : JSON.stringify(data),
    });
    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Apinator publish failed:', e);
    return res.status(500).json({ error: 'Publish failed' });
  }
}
