// Vercel serverless function for the Dili Streak Brawl leaderboard.
// Uses Vercel KV (Upstash Redis) through its REST API. No dependencies.
// Env vars, injected by Vercel when a KV store is linked to the project:
//   KV_REST_API_URL, KV_REST_API_TOKEN
// If they are missing, the leaderboard reports not configured and stores nothing.

const KEY = "dili-leaderboard";
const MAX_NAME = 12;
const MAX_SCORE = 10000000;

function kvConfig() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  return { url: String(url).replace(/\/$/, ""), token: token };
}

async function kv(path, method) {
  const cfg = kvConfig();
  const res = await fetch(cfg.url + path, {
    method: method || "GET",
    headers: { Authorization: "Bearer " + cfg.token },
  });
  if (!res.ok) throw new Error("kv request failed: " + res.status);
  return res.json();
}

module.exports = async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  const cfg = kvConfig();
  if (!cfg) {
    if (req.method === "GET") return res.status(200).json({ scores: [], configured: false });
    return res.status(200).json({ ok: false, error: "leaderboard not configured" });
  }
  try {
    if (req.method === "GET") {
      const data = await kv("/zrevrange/" + KEY + "/0/9/WITHSCORES", "GET");
      const result = data.result || [];
      const scores = [];
      for (let i = 0; i + 1 < result.length; i += 2) {
        try {
          const entry = JSON.parse(result[i]);
          scores.push({ name: entry.name, score: Number(result[i + 1]) });
        } catch (e) { /* skip bad entries */ }
      }
      return res.status(200).json({ scores: scores, configured: true });
    }
    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const name = String(body.name || "").trim().slice(0, MAX_NAME);
      const score = Math.floor(Number(body.score));
      if (!name || !score || score <= 0 || score > MAX_SCORE) {
        return res.status(200).json({ ok: false, error: "invalid name or score" });
      }
      const member = JSON.stringify({ name: name, score: score, ts: Date.now() });
      await kv("/zadd/" + KEY + "/" + score + "/" + encodeURIComponent(member), "POST");
      const rankData = await kv("/zrevrank/" + KEY + "/" + encodeURIComponent(member), "GET");
      const rank = (rankData.result === null || rankData.result === undefined) ? null : Number(rankData.result) + 1;
      return res.status(200).json({ ok: true, rank: rank });
    }
    return res.status(405).json({ ok: false, error: "method not allowed" });
  } catch (e) {
    return res.status(200).json({ ok: false, error: "leaderboard unavailable" });
  }
};
