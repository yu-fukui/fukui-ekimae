// お問い合わせ・更新依頼が届いたら、運営にメールで知らせる
// Supabase の Database Webhook（inquiries / update_requests の INSERT）から呼ばれる。
// ログイン不要で呼ばれるので、Webhook に設定した合言葉（x-webhook-secret）で確かめる。
import { json, SITE_URL } from "../_shared/util.ts";

type Payload = { type: string; table: string; record: Record<string, unknown> };
export type Mail = { subject: string; text: string };
export type Deps = {
  secret: string;
  send: (mail: Mail) => Promise<void>;
  shopName: (shopId: string) => Promise<string>;
};

const KIND: Record<string, string> = { owner: "店舗会員の申し込み（お店のオーナー）", fix: "掲載内容の修正依頼", remove: "掲載の取りやめ", closed: "閉店・移転などの情報", other: "その他" };
const ADMIN_URL = () => `${SITE_URL}kanri-e9bd6eaadd/`;

function same(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function compose(p: Payload, shopName: Deps["shopName"]): Promise<Mail | null> {
  const r = p.record ?? {};
  if (p.type !== "INSERT") return null;
  if (p.table === "inquiries") {
    const kind = KIND[String(r.kind)] ?? KIND.other;
    return {
      subject: `【ふくいエキマエ】${r.kind === "owner" ? "店舗会員の申し込み" : "お問い合わせ"}：${r.shop_name}`,
      text: `サイトからお問い合わせが届きました。\n\nご用件：${kind}\n店名：${r.shop_name}\n連絡先：${r.contact}\n\n${r.message || "（本文なし）"}\n\n管理画面：${ADMIN_URL()}`,
    };
  }
  if (p.table === "update_requests") {
    const name = await shopName(String(r.shop_id));
    return {
      subject: `【ふくいエキマエ】情報の更新依頼：${name}`,
      text: `無料掲載のお店から、情報の更新依頼が届きました。\n\n店名：${name}\n\n${r.body}\n\n管理画面：${ADMIN_URL()}`,
    };
  }
  return null;
}

export async function handler(req: Request, deps: Deps): Promise<Response> {
  if (req.method !== "POST") return json({ error: "POST だけ受け付けます" }, 405);
  if (!same(req.headers.get("x-webhook-secret") ?? "", deps.secret)) return json({ error: "合言葉が違います" }, 401);
  let p: Payload;
  try { p = await req.json(); } catch { return json({ error: "JSON ではありません" }, 400); }
  const mail = await compose(p, deps.shopName);
  if (!mail) return json({ skipped: true });
  await deps.send(mail);
  return json({ sent: true });
}

// Resend の API でメールを送る（Auth の SMTP に Resend を使っているなら同じ API キーでよい）
async function sendWithResend(mail: Mail) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("NOTIFY_FROM") ?? "ふくいエキマエ <onboarding@resend.dev>",
      to: (Deno.env.get("NOTIFY_TO") ?? "yasu29fr@gmail.com").split(",").map((s) => s.trim()),
      subject: mail.subject, text: mail.text,
    }),
  });
  if (!res.ok) throw new Error(`メールを送れませんでした（${res.status} ${await res.text()}）`);
}

if (import.meta.main) {
  const { admin } = await import("../_shared/util.ts");
  Deno.serve((req) => handler(req, {
    secret: Deno.env.get("NOTIFY_WEBHOOK_SECRET") ?? "",
    send: sendWithResend,
    shopName: async (id) => (await admin.from("shops").select("name").eq("id", id).maybeSingle()).data?.name ?? "（不明な店）",
  }));
}
