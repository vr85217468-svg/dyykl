// Netlify Function — يجلب تعليقات البث ويحفظها في Supabase
// يعمل دائماً حتى لو Supabase غير متاح

const VIDEO_ID = "6_9ZiuONXt0";
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const supabaseReady = !!(SUPABASE_URL && SUPABASE_KEY);

// ─── Supabase ───────────────────────────────────────────
async function dbInsert(rows) {
  if (!rows.length) return;
  await fetch(`${SUPABASE_URL}/rest/v1/comments`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
}

async function dbGetAll() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/comments?select=*&order=created_at.asc&limit=50000`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
      },
    }
  );
  return res.ok ? res.json() : [];
}

// ─── YouTube ─────────────────────────────────────────────
async function fetchYouTubeChat() {
  const page = await fetch(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/121.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const html = await page.text();

  // مفتاح يوتيوب الداخلي
  const keyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  const ytKey = keyMatch ? keyMatch[1] : "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

  // ytInitialData
  const marker = "var ytInitialData = ";
  const si = html.indexOf(marker);
  if (si === -1) return [];

  let depth = 0, i = si + marker.length, end = i;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (!depth) { end = i + 1; break; } }
  }

  const ytData = JSON.parse(html.slice(si + marker.length, end));
  const cons = ytData?.contents?.twoColumnWatchNextResults
    ?.conversationBar?.liveChatRenderer?.continuations || [];

  const cont =
    cons[0]?.reloadContinuationData?.continuation ||
    cons[0]?.invalidationContinuationData?.continuation ||
    cons[0]?.timedContinuationData?.continuation;

  if (!cont) return [];

  const chatRes = await fetch(
    `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${ytKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: { client: { clientName: "WEB", clientVersion: "2.20240201.00.00" } },
        continuation: cont,
      }),
    }
  );

  const chatData = await chatRes.json();
  const actions = chatData?.continuationContents?.liveChatContinuation?.actions || [];

  // التوقيت العراقي UTC+3
  const iraqNow = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  const msgs = [];
  for (const a of actions) {
    const r = a?.addChatItemAction?.item?.liveChatTextMessageRenderer;
    if (!r) continue;
    const msg = (r.message?.runs || []).map((x) => x.text || "").join("").trim();
    if (msg) msgs.push({
      youtube_id: r.id || null,
      author: r.authorName?.simpleText?.trim() || "مجهول",
      message: msg,
      created_at: iraqNow,
    });
  }
  return msgs;
}

// ─── Handler ─────────────────────────────────────────────
exports.handler = async function () {
  let ytMessages = [];
  let allMessages = [];
  let info = null;

  // 1️⃣ جلب التعليقات الجديدة من يوتيوب
  try {
    ytMessages = await fetchYouTubeChat();
  } catch (e) {
    info = "خطأ يوتيوب: " + e.message;
  }

  // 2️⃣ حفظ في Supabase + جلب الكل منه
  if (supabaseReady) {
    try { await dbInsert(ytMessages); } catch (_) { }
    try { allMessages = await dbGetAll(); } catch (_) { }
  }

  // 3️⃣ إذا لم تنجح Supabase، اعرض تعليقات يوتيوب مباشرةً
  if (allMessages.length === 0) {
    allMessages = ytMessages.map((m, i) => ({ id: i, ...m }));
    if (!supabaseReady) info = "⚠️ Supabase غير مضبوط — التعليقات مؤقتة فقط";
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify({
      messages: allMessages,
      new_count: ytMessages.length,
      total: allMessages.length,
      info,
    }),
  };
};
