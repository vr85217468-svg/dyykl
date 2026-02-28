// Netlify Function - يجلب تعليقات البث ويحفظها في Supabase
// بيانات Supabase مخفية في Environment Variables على Netlify

const VIDEO_ID = "6_9ZiuONXt0";

// قراءة بيانات Supabase من متغيرات البيئة (محمية على Netlify)
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// ─── دوال Supabase ───

async function dbSelectAll() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/comments?select=*&order=created_at.asc&limit=50000`,
    {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!res.ok) throw new Error(`Supabase select error: ${await res.text()}`);
  return res.json();
}

async function dbInsertMany(rows) {
  if (!rows.length) return;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/comments`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok && res.status !== 409) {
    const err = await res.text();
    throw new Error(`Supabase insert error: ${err}`);
  }
}

// ─── جلب تعليقات يوتيوب ───

async function fetchYouTubeChat() {
  // فتح صفحة يوتيوب
  const pageRes = await fetch(`https://www.youtube.com/watch?v=${VIDEO_ID}`, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  const html = await pageRes.text();

  // استخراج المفتاح الداخلي ليوتيوب (مضمّن تلقائياً في كل صفحة)
  const keyMatch = html.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  const ytKey = keyMatch ? keyMatch[1] : "AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8";

  // استخراج ytInitialData
  const marker = "var ytInitialData = ";
  const start = html.indexOf(marker);
  if (start === -1) return { messages: [], reason: "البث غير نشط" };

  let depth = 0, i = start + marker.length, end = i;
  for (; i < html.length; i++) {
    if (html[i] === "{") depth++;
    else if (html[i] === "}") { depth--; if (depth === 0) { end = i + 1; break; } }
  }

  const ytData = JSON.parse(html.slice(start + marker.length, end));

  // البحث عن continuation token للدردشة المباشرة
  const continuations =
    ytData?.contents?.twoColumnWatchNextResults?.conversationBar
      ?.liveChatRenderer?.continuations || [];

  const continuation =
    continuations[0]?.reloadContinuationData?.continuation ||
    continuations[0]?.invalidationContinuationData?.continuation ||
    continuations[0]?.timedContinuationData?.continuation;

  if (!continuation) return { messages: [], reason: "لا توجد دردشة مباشرة" };

  // جلب التعليقات بالـ API الداخلي
  const chatRes = await fetch(
    `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${ytKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        context: {
          client: { clientName: "WEB", clientVersion: "2.20240201.00.00" },
        },
        continuation,
      }),
    }
  );

  const chatData = await chatRes.json();
  const actions =
    chatData?.continuationContents?.liveChatContinuation?.actions || [];

  // التوقيت العراقي (UTC+3)
  const iraqNow = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString();

  const messages = [];
  for (const action of actions) {
    const r = action?.addChatItemAction?.item?.liveChatTextMessageRenderer;
    if (!r) continue;
    const youtube_id = r.id || null;
    const author = r.authorName?.simpleText?.trim() || "مجهول";
    const message = (r.message?.runs || []).map((x) => x.text || "").join("").trim();
    if (message) messages.push({ youtube_id, author, message, created_at: iraqNow });
  }

  return { messages, reason: null };
}

// ─── Handler الرئيسي ───

exports.handler = async function (event, context) {
  const errors = [];

  // 1. التحقق من وجود بيانات Supabase
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return respond([], 0, 0, "❌ متغيرات البيئة SUPABASE_URL و SUPABASE_KEY غير مضبوطة على Netlify");
  }

  // 2. جلب تعليقات يوتيوب
  let newMessages = [];
  let ytReason = null;
  try {
    const result = await fetchYouTubeChat();
    newMessages = result.messages;
    ytReason = result.reason;
  } catch (e) {
    errors.push("YouTube: " + e.message);
  }

  // 3. حفظ التعليقات الجديدة في Supabase
  let savedCount = 0;
  try {
    await dbInsertMany(newMessages);
    savedCount = newMessages.length;
  } catch (e) {
    errors.push("Supabase insert: " + e.message);
  }

  // 4. جلب كل التعليقات من Supabase
  let allMessages = [];
  try {
    allMessages = await dbSelectAll();
  } catch (e) {
    errors.push("Supabase select: " + e.message);
  }

  return respond(
    allMessages,
    savedCount,
    allMessages.length,
    ytReason || (errors.length ? errors.join(" | ") : null)
  );
};

function respond(messages, new_count, total, info) {
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify({ messages, new_count, total, info }),
  };
}
