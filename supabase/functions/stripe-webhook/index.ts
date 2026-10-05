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

const fmt = (d: Date) => `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
const jst = (sec: number) => new Date(sec * 1000 + 9 * 3600_000);   // 日本時間の日付にする
const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

// Resend でメールを送る（差出人は返信を受けない no-reply）
async function sendMail(to: string[], subject: string, text: string, from: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key || !to.length) return;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status} ${await res.text()}`);
}

export function welcomeText(shopName: string, sub: Stripe.Subscription, site: string) {
  const item = sub.items.data[0];
  const price = item?.price;
  const yearly = price?.recurring?.interval === "year";
  const amount = typeof price?.unit_amount === "number" ? yen(price.unit_amount) : "";
  const plan = `${yearly ? "年額" : "月額"}プラン（${amount}／${yearly ? "年" : "月"}・税込）`;
  const lines = [
    `${shopName} ご担当者さま`,
    "",
    "ふくいエキマエの有料掲載プランにお申し込みいただき、ありがとうございます。",
    "お店のページは、今から有料掲載（写真・紹介文・リンクの掲載、一覧での優先表示）になります。",
    "",
    "■ ご契約の内容",
    `・お店：${shopName}`,
    `・プラン：${plan}`,
  ];
  if (sub.trial_end) {
    lines.push(`・無料期間：${fmt(jst(sub.trial_end))}まで（キャンペーン）`);
    lines.push(`・お支払いの開始：${fmt(jst(sub.trial_end))}に初回のお支払い。以後${yearly ? "1年" : "1か月"}ごとに自動で更新`);
    lines.push("・無料期間中に解約すれば、料金はかかりません");
  } else {
    const end = (sub as unknown as { current_period_end?: number }).current_period_end ?? (item as unknown as { current_period_end?: number })?.current_period_end;
    if (end) lines.push(`・次回の更新日：${fmt(jst(end))}（以後${yearly ? "1年" : "1か月"}ごとに自動で更新）`);
  }
  lines.push(
    "",
    "■ お店の管理画面",
    `${site}owner/`,
    "写真・紹介文・営業時間などは、この画面からいつでも直せます。",
    "お支払い方法の変更・解約も、管理画面の「お支払い方法の変更・解約」からできます。",
    "",
    "■ お問い合わせ",
    `${site}#inquiry`,
    "",
    "※このメールは送信専用のアドレスから送っています。ご返信いただいてもお答えできません。",
    "",
    "ふくいエキマエ（ふくふくプロジェクト）",
    site,
  );
  return lines.join("\n");
}

async function sendWelcome(cs: Stripe.Checkout.Session, sub: Stripe.Subscription, db: SupabaseClient) {
  const shopId = sub.metadata?.shop_id;
  if (!shopId) return;
  const { data: shop } = await db.from("shops").select("name").eq("id", shopId).maybeSingle();
  const name = shop?.name ?? "お店";
  const site = (Deno.env.get("SITE_URL") || "https://ekimae.fukui-fukui.com/").replace(/\/?$/, "/");
  const to = cs.customer_details?.email || cs.customer_email || "";
  const noreply = Deno.env.get("WELCOME_FROM") ?? "ふくいエキマエ <no-reply@fukui-fukui.com>";
  if (to) await sendMail([to], `【ふくいエキマエ】有料掲載プランのお申し込みありがとうございます（${name}）`, welcomeText(name, sub, site), noreply);
  // 運営へのお知らせ
  const admins = (Deno.env.get("NOTIFY_TO") ?? "yasu29fr@gmail.com").split(",").map((x) => x.trim()).filter(Boolean);
  const item = sub.items.data[0];
  await sendMail(admins, `【ふくいエキマエ】有料掲載の新しいお申し込み：${name}`,
    `お店：${name}\nプラン：${item?.price?.recurring?.interval === "year" ? "年額" : "月額"}\n無料期間：${sub.trial_end ? fmt(jst(sub.trial_end)) + "まで" : "なし"}\nお申し込みのメール：${to}\n\nStripe でサブスクを確かめてください。`,
    Deno.env.get("NOTIFY_FROM") ?? noreply);
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
        // お申し込み完了のメール（お店あて）と、運営へのお知らせ。失敗しても契約の記録は済んでいるので止めない
        try { await sendWelcome(cs, sub, db); } catch (e) { console.error("お申し込みメールを送れませんでした", e); }
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
