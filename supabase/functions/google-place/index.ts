// お店のページに Google の口コミの星と件数を出す
// 代表（2026-10-08）「Googleの口コミの星だけでいいかなと思う。マップへのリンクがあるので。」
// 代表（2026-10-08）「Googleのデータの表示方法はこれでOKです。全体に反映して、テストは非表示に。」
// Google の決まりで保存してよいのは place_id だけ（shops.google_place_id）。星と件数はページが開かれるたびに Google から取る。
// place_id が入っていて、非表示でないお店だけを受け付ける。キーは Supabase の Secrets（GOOGLE_PLACES_API_KEY）。
// 共通部品（_shared/util.ts）は Stripe なども読み込むので使わず、ここで最小限だけ持つ
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MONTHLY_CAP = 950;   // 星の問い合わせの月の上限（ほかの処理の分を少し残す）
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) return json({ error: "GOOGLE_PLACES_API_KEY が設定されていません" }, 500);
  // 検索ロボットには星を出さない（Google に問い合わせない。11/15：1週間で516回に増えた）
  if (/bot|crawl|spider|slurp|preview|lighthouse|headless/i.test(req.headers.get("user-agent") ?? "")) return json({ rating: null, count: 0 });
  const { slug } = await req.json().catch(() => ({}));
  if (!/^[a-z0-9-]{1,40}$/.test(String(slug || ""))) return json({ error: "このお店は対象外です" }, 404);

  // place_id は public_shops に出していないので service_role で読む
  const base = Deno.env.get("SUPABASE_URL")!, sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const q = await fetch(`${base}/rest/v1/shops?slug=eq.${slug}&is_hidden=eq.false&select=google_place_id`, {
    headers: { apikey: sr, Authorization: `Bearer ${sr}` },
  });
  const id = q.ok ? (await q.json())[0]?.google_place_id : null;
  if (!id) return json({ error: "このお店は対象外です" }, 404);

  // 今月の回数が上限に近づいたら、月末まで星を出さない（無料の範囲＝月1,000回をこえないため。こえるかは代表が決める）
  const month = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 7);
  const used = await fetch(`${base}/rest/v1/places_usage?source=eq.google-place&day=gte.${month}-01&select=calls`, {
    headers: { apikey: sr, Authorization: `Bearer ${sr}` },
  }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
  if ((used as { calls: number }[]).reduce((a, x) => a + x.calls, 0) >= MONTHLY_CAP) return json({ rating: null, count: 0 });

  // Google に問い合わせた回数を数える（代表 10/13「1週間の数字を報告して」）。数えられなくても星は出す
  await fetch(`${base}/rest/v1/rpc/count_places_call`, {
    method: "POST",
    headers: { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_source: "google-place" }),
  }).catch(() => {});

  const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(id)}`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "rating,userRatingCount" },
  });
  if (!r.ok) return json({ error: `Google がエラーを返しました（${r.status}）` }, 502);
  const p = await r.json();
  return json({ rating: p.rating ?? null, count: p.userRatingCount ?? 0 });
});
