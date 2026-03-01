// قراءة كل التعليقات المحفوظة من Supabase
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

exports.handler = async function () {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ comments: [], error: "Supabase غير مضبوط" }),
        };
    }

    try {
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/comments?select=*&order=created_at.desc&limit=50000`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`,
                },
            }
        );
        const comments = res.ok ? await res.json() : [];
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ comments, total: comments.length }),
        };
    } catch (e) {
        return {
            statusCode: 200,
            headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
            body: JSON.stringify({ comments: [], error: e.message }),
        };
    }
};
