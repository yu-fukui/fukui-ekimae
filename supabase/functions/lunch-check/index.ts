// ランチの印を付ける（代表 10/28「ランチのボタンとGoogleの営業時間を元にして」、統括 10/29 費用0円の見込みで了承）
// Google の営業時間を見て「昼（12:00〜13:00）ずっと開いている曜日がある」お店に shops.lunch_google = true を付ける。
// Google の決まりで営業時間そのものは保存しない。保存するのは印と調べた日（lunch_checked）だけ。
// 1回の呼び出しで、調べてから25日以上たったお店（または未調査のお店）を最大 BATCH 軒だけ調べる。
// 誰が何回呼んでも、1軒あたり25日に1回しか Google に問い合わせないので、月の回数は飲食店の軒数（約480回）をこえない。
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const BATCH = 100;
const REFRESH_DAYS = 25;
const NOON = 12 * 60, ONE = 13 * 60;   // この1時間ずっと開いていれば「ランチあり」
const WEEK = 7 * 24 * 60;

type Point = { day: number; hour?: number; minute?: number };
type Period = { open: Point; close?: Point };

// Google の periods から「12:00〜13:00 をまるごと含む時間帯がある曜日」があるかを見る
export function hasLunch(periods: Period[] | undefined): boolean | null {
  if (!periods || !periods.length) return null;   // 営業時間が出ていない：わからない
  for (const p of periods) {
    if (!p.close) return true;                     // 24時間営業
    const at = (x: Point) => x.day * 1440 + (x.hour ?? 0) * 60 + (x.minute ?? 0);
    const o = at(p.open);
    let c = at(p.close);
    if (c <= o) c += WEEK;                         // 土曜→日曜をまたぐ
    for (let d = 0; d < 8; d++) {
      const s = d * 1440 + NOON, e = d * 1440 + ONE;
      if (o <= s && e <= c) return true;
    }
  }
  return false;
}

const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);   // 日本時間の日付

if (import.meta.main) Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "POST だけ受け付けます" }, 405);
  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) return json({ error: "GOOGLE_PLACES_API_KEY が設定されていません" }, 500);
  const base = Deno.env.get("SUPABASE_URL")!, sr = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const h = { apikey: sr, Authorization: `Bearer ${sr}`, "Content-Type": "application/json" };

  const since = new Date(Date.now() + 9 * 3600_000 - REFRESH_DAYS * 86400_000).toISOString().slice(0, 10);
  const q = await fetch(`${base}/rest/v1/shops?select=id,google_place_id&is_hidden=eq.false&category=eq.gourmet`
    + `&google_place_id=not.is.null&or=(lunch_checked.is.null,lunch_checked.lt.${since})&order=lunch_checked.nullsfirst,slug&limit=${BATCH}`, { headers: h });
  if (!q.ok) return json({ error: `お店を読めませんでした（${q.status}）` }, 500);
  const shops: { id: string; google_place_id: string }[] = await q.json();

  let yes = 0, no = 0, unknown = 0, failed = 0;
  for (const s of shops) {
    // 先に「調べた日」を付ける（同時に呼ばれても同じ店を二重に問い合わせないように）
    const claim = await fetch(`${base}/rest/v1/shops?id=eq.${s.id}&or=(lunch_checked.is.null,lunch_checked.lt.${since})`, {
      method: "PATCH", headers: { ...h, Prefer: "return=representation" }, body: JSON.stringify({ lunch_checked: today() }),
    });
    if (!claim.ok || !(await claim.json()).length) continue;
    await fetch(`${base}/rest/v1/rpc/count_places_call`, { method: "POST", headers: h, body: JSON.stringify({ p_source: "lunch-check" }) }).catch(() => {});
    const r = await fetch(`https://places.googleapis.com/v1/places/${encodeURIComponent(s.google_place_id)}`, {
      headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": "regularOpeningHours.periods" },
    });
    if (!r.ok) { failed++; continue; }   // 印は前のまま。25日後にまた調べる
    const lunch = hasLunch((await r.json()).regularOpeningHours?.periods);
    if (lunch === true) yes++; else if (lunch === false) no++; else unknown++;
    await fetch(`${base}/rest/v1/shops?id=eq.${s.id}`, { method: "PATCH", headers: h, body: JSON.stringify({ lunch_google: lunch }) });
  }
  return json({ checked: shops.length, yes, no, unknown, failed });
});
