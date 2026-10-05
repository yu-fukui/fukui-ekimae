// 有料プランの申し込み：Stripe の決済画面（Checkout）の URL を返す
import { admin, assertMember, currentUser, handle, HttpError, json, safeReturn, stripe } from "../_shared/util.ts";

Deno.serve(handle(async (req) => {
  const user = await currentUser(req);
  const { shop_id, plan, return_url } = await req.json();
  await assertMember(user.id, shop_id);
  const price = plan === "yearly" ? Deno.env.get("STRIPE_PRICE_YEARLY") : plan === "monthly" ? Deno.env.get("STRIPE_PRICE_MONTHLY") : null;
  if (!price) throw new HttpError(plan === "yearly" || plan === "monthly" ? 503 : 400, "決済は準備中です（not configured）");
  const s = stripe();

  const { data: shop } = await admin.from("shops").select("is_hidden").eq("id", shop_id).maybeSingle();
  if (!shop || shop.is_hidden) throw new HttpError(403, "サイトに掲載していないお店は、お申し込みできません。運営にご連絡ください。");
  const { data: sub } = await admin.from("subscriptions").select("*").eq("shop_id", shop_id).maybeSingle();
  if (sub && ["active", "trialing", "past_due"].includes(sub.status)) throw new HttpError(409, "すでに有料プランのご契約があります");

  // 期間限定のクーポンを自動で付ける（Secrets：STRIPE_AUTO_COUPON にクーポン ID、STRIPE_AUTO_COUPON_UNTIL に最終日 YYYY-MM-DD・日本時間）
  const autoCoupon = Deno.env.get("STRIPE_AUTO_COUPON") ?? "";
  const until = Deno.env.get("STRIPE_AUTO_COUPON_UNTIL") ?? "";
  const useCoupon = Boolean(autoCoupon) && (!until || Date.now() < new Date(`${until}T23:59:59+09:00`).getTime());

  // キャンペーン：期間中のお申し込みは最初の数か月を無料（Stripe の無料期間＝トライアル）
  // 既定は「2026/10/31 までのお申し込みは6か月無料」。Secrets の CAMPAIGN_UNTIL / CAMPAIGN_FREE_MONTHS で変えられる（0 で止める）
  const campUntil = Deno.env.get("CAMPAIGN_UNTIL") ?? "2026-10-31";
  const freeMonths = Number(Deno.env.get("CAMPAIGN_FREE_MONTHS") ?? "6");
  let trialEnd: number | null = null;
  if (freeMonths > 0 && Date.now() < new Date(`${campUntil}T23:59:59+09:00`).getTime() && !sub) {
    const t = new Date(); t.setMonth(t.getMonth() + freeMonths);
    trialEnd = Math.floor(t.getTime() / 1000);
  }

  const back = safeReturn(return_url);
  const sep = back.includes("?") ? "&" : "?";
  const session = await s.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price, quantity: 1 }],
    client_reference_id: shop_id,
    metadata: { shop_id },
    subscription_data: { metadata: { shop_id }, ...(trialEnd ? { trial_end: trialEnd } : {}) },
    ...(sub?.stripe_customer_id ? { customer: sub.stripe_customer_id } : { customer_email: user.email }),
    locale: "ja",
    // クーポンの自動適用とプロモーションコード入力欄は同時に使えない
    ...(useCoupon ? { discounts: [{ coupon: autoCoupon }] } : { allow_promotion_codes: true }),
    // Managed Payments（Stripe が販売者になる仕組み）は使わない。ふくふくプロジェクトが販売者として売る
    ...({ managed_payments: { enabled: false } } as Record<string, unknown>),
    success_url: `${back}${sep}checkout=success&shop=${shop_id}`,
    cancel_url: `${back}${sep}checkout=cancel&shop=${shop_id}`,
  });
  return json({ url: session.url });
}));
