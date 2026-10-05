// Stripe からの通知を受けて、お店のプランを切り替える
// （ログイン不要で呼ばれるので、署名で Stripe からの通知かを必ず確かめる）
import Stripe from "npm:stripe@17";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { json, stripe } from "../_shared/util.ts";

const ACTIVE = new Set(["active", "trialing", "past_due"]);
const GRACE_DAYS = 3;   // 更新日にカードが通らなくても、再請求の間は数日掲載を続ける

export async function applySubscription(sub: Stripe.Subscription, db: SupabaseClient) {
  const shopId = sub.metadata?.shop_id;
  if (!shopId) { console.warn("shop_id のない契約", sub.id); return; }
  const item = sub.items.data[0];
  const interval = item?.price?.recurring?.interval ?? "";
  // API の版によって current_period_end の場所が違う（契約本体 / 明細）
  const endSec = (sub as unknown as { current_period_end?: number }).current_period_end ?? (item as unknown as { current_period_end?: number })?.current_period_end;
  const periodEnd = endSec ? new Date(endSec * 1000) : null;
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  // 解約の予定（期間の終わりに解約、または日付指定の解約）
  const cancelAt = sub.cancel_at ? new Date(sub.cancel_at * 1000) : sub.cancel_at_period_end ? periodEnd : null;

  await db.from("subscriptions").upsert({
    shop_id: shopId, stripe_customer_id: customer, stripe_subscription_id: sub.id, status: sub.status,
    interval, current_period_end: periodEnd?.toISOString() ?? null, cancel_at: cancelAt?.toISOString() ?? null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "shop_id" });

  if (ACTIVE.has(sub.status) && periodEnd) {
    const until = new Date(periodEnd.getTime() + GRACE_DAYS * 86400_000);
    await db.from("shops").update({ plan: interval === "year" ? "yearly" : "monthly", plan_until: until.toISOString() }).eq("id", shopId);
  } else if (["canceled", "unpaid", "incomplete_expired"].includes(sub.status)) {
    await db.from("shops").update({ plan: "free", plan_until: null }).eq("id", shopId);
  }
}

export async function handler(req: Request, db: SupabaseClient): Promise<Response> {
  const secret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!secret) return json({ error: "not configured" }, 503);
  const s = stripe();
  let event: Stripe.Event;
  try {
    event = await s.webhooks.constructEventAsync(await req.text(), req.headers.get("stripe-signature") ?? "", secret,
      undefined, Stripe.createSubtleCryptoProvider());
  } catch (e) {
    return json({ error: `署名を確認できません: ${(e as Error).message}` }, 400);
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const cs = event.data.object as Stripe.Checkout.Session;
      if (cs.mode === "subscription" && cs.subscription) {
        const sub = await s.subscriptions.retrieve(String(cs.subscription));
        if (!sub.metadata?.shop_id && cs.client_reference_id) sub.metadata = { ...sub.metadata, shop_id: cs.client_reference_id };
        await applySubscription(sub, db);
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await applySubscription(event.data.object as Stripe.Subscription, db);
      break;
  }
  return json({ received: true });
}

if (import.meta.main) {
  const { admin } = await import("../_shared/util.ts");
  Deno.serve((req) => handler(req, admin));
}
