// お店のページに Google の口コミの星と件数を出す（試験中）
// 代表の指示（2026-10-08）「洋食堂だけ、実装してほしい。ただし、複製して、確認が終わったら非表示にできるようにしてください。」
// 代表（2026-10-08）「Googleの口コミの星だけでいいかなと思う。マップへのリンクがあるので。」→ 星と件数だけを取る
// Google の決まりで保存はしない。ページが開かれるたびに Google から取って返す。
// 料金を抑えるため、試験中のお店（ALLOW）だけを受け付ける。キーは Supabase の Secrets（GOOGLE_PLACES_API_KEY）。
// 共通部品（_shared/util.ts）は Stripe なども読み込むので使わず、ここで最小限だけ持つ
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const ALLOW: Record<string, string> = {
  "s4bb210af-gtest": "ChIJybOzArO_-F8Rb51FSEEMBUs", // 洋食堂 yousyokudou（Google 表示の試験用の複製）
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) return json({ error: "GOOGLE_PLACES_API_KEY が設定されていません" }, 500);
  const { slug } = await req.json().catch(() => ({}));
  const id = ALLOW[String(slug || "")];
  if (!id) return json({ error: "このお店は対象外です" }, 404);

  const r = await fetch(`https://places.googleapis.com/v1/places/${id}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "rating,userRatingCount" },
  });
  if (!r.ok) return json({ error: `Google がエラーを返しました（${r.status}）` }, 502);
  const p = await r.json();
  return json({ rating: p.rating ?? null, count: p.userRatingCount ?? 0 });
});
