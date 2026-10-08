// お店のページに Google の情報（星・口コミ・写真・営業時間など）を出す（試験中）
// 代表の指示（2026-10-08）「洋食堂だけ、実装してほしい。ただし、複製して、確認が終わったら非表示にできるようにしてください。」
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
const FIELDS = [
  "id", "displayName", "googleMapsUri", "websiteUri", "nationalPhoneNumber", "regularOpeningHours", "currentOpeningHours",
  "rating", "userRatingCount", "priceRange", "reviews", "photos", "takeout", "reservable", "servesLunch", "servesDinner",
  "servesBeer", "servesWine", "goodForChildren", "goodForGroups", "paymentOptions",
].join(",");
const PHOTOS = 3;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const key = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!key) return json({ error: "GOOGLE_PLACES_API_KEY が設定されていません" }, 500);
  const { slug } = await req.json().catch(() => ({}));
  const id = ALLOW[String(slug || "")];
  if (!id) return json({ error: "このお店は対象外です" }, 404);

  const r = await fetch(`https://places.googleapis.com/v1/places/${id}?languageCode=ja&regionCode=JP`, {
    headers: { "X-Goog-Api-Key": key, "X-Goog-FieldMask": FIELDS },
  });
  if (!r.ok) return json({ error: `Google がエラーを返しました（${r.status}）` }, 502);
  const p = await r.json();

  // 写真は画像の URL（キーを含まない）と撮った人だけを返す。1枚ごとに料金がかかる
  const photos = [];
  for (const ph of (p.photos || []).slice(0, PHOTOS)) {
    const m = await fetch(`https://places.googleapis.com/v1/${ph.name}/media?maxWidthPx=800&skipHttpRedirect=true&key=${key}`);
    if (!m.ok) continue;
    const { photoUri } = await m.json();
    const a = (ph.authorAttributions || [])[0] || {};
    photos.push({ src: photoUri, by: a.displayName || "", byUri: a.uri || "" });
  }
  return json({
    name: p.displayName?.text, mapsUri: p.googleMapsUri, website: p.websiteUri, tel: p.nationalPhoneNumber,
    rating: p.rating, count: p.userRatingCount,
    openNow: (p.currentOpeningHours || p.regularOpeningHours || {}).openNow ?? null,
    hours: p.regularOpeningHours?.weekdayDescriptions || [],
    price: p.priceRange ? [p.priceRange.startPrice?.units, p.priceRange.endPrice?.units] : null,
    features: {
      takeout: p.takeout, reservable: p.reservable, servesLunch: p.servesLunch, servesDinner: p.servesDinner,
      servesBeer: p.servesBeer, servesWine: p.servesWine, goodForChildren: p.goodForChildren, goodForGroups: p.goodForGroups,
      acceptsCreditCards: p.paymentOptions?.acceptsCreditCards,
    },
    reviews: (p.reviews || []).slice(0, 3).map((v: any) => ({
      text: v.text?.text || "", rating: v.rating, when: v.relativePublishTimeDescription,
      by: v.authorAttribution?.displayName || "", byUri: v.authorAttribution?.uri || "",
    })),
    photos,
  });
});
