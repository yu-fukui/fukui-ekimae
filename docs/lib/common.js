// オーナー画面・運営画面で共通の部品（Supabase への接続、画像の縮小など）
import { createDemoClient, demoUrls } from "./demo-sb.js?v=4";

export const cfg = window.FUKUFUKU_CONFIG || {};
// ?demo=login / free / owner / admin のときは、見本のデータで画面だけ動かす（保存はされない）
export const demo = new URLSearchParams(location.search).get("demo");
const hasDb = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
export const ready = hasDb || Boolean(demo);
// 接続先が設定されているときだけ supabase-js を読み込む
const { createClient } = hasDb && !demo ? await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm") : {};
export const sb = demo ? createDemoClient(demo) : hasDb ? createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
if (demo) {
  const bar = document.createElement("div");
  bar.className = "demo-bar";
  bar.innerHTML = "<b>見本</b>の画面です（保存はされません）";
  document.body.prepend(bar);
}

export const $ = (s, root = document) => root.querySelector(s);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const ZONES = { ekimae: "駅前", katamachi: "片町" };
export const PLANS = { free: "無料", monthly: "有料（月額）", yearly: "有料（年額）" };
export const LINK_KINDS = {
  web: "ホームページ", tabelog: "食べログ", hotpepper: "ホットペッパー", gmap: "Googleマップ", x: "X",
  threads: "Threads", tiktok: "TikTok", line: "LINE公式", reserve: "予約ページ", other: "その他",
};

export function photoUrl(path) {
  if (demoUrls.has(path)) return demoUrls.get(path);
  if (/^(\.\.?\/|https?:)/.test(path)) return path;
  return `${cfg.supabaseUrl}/storage/v1/object/public/photos/${path.split("/").map(encodeURIComponent).join("/")}`;
}

export function isPaid(shop) {
  return shop.plan !== "free" && (!shop.plan_until || new Date(shop.plan_until) > new Date()) && !shop.is_hidden;
}

export function fmtDate(s) {
  if (!s) return "";
  const d = new Date(s);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// スマホの写真を長辺1600pxの WebP にする。canvas を通すので撮影場所などの情報（EXIF）は残らない。
export async function shrinkImage(file, maxSide = 1600, quality = 0.82) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/webp", quality));
  if (blob && blob.type === "image/webp") return blob;
  return new Promise((res) => canvas.toBlob(res, "image/jpeg", quality));   // WebP 非対応の古い Safari
}

// Edge Function を呼ぶ（ログイン中のトークンを付けて）
export async function callFn(name, body) {
  const { data, error } = await sb.functions.invoke(name, { body });
  if (error) {
    let msg = error.message;
    try { msg = (await error.context.json()).error || msg; } catch (_) {}
    throw new Error(msg);
  }
  return data;
}

export function toast(msg, kind = "") {
  let el = document.getElementById("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.append(el); }
  el.textContent = msg; el.className = `toast show ${kind}`;
  clearTimeout(el._t); el._t = setTimeout(() => (el.className = "toast"), 3200);
}

// ログイン画面（招待済みの人だけ。新規登録はさせない）
// ふだんはメールアドレスとパスワード。パスワードを忘れた・まだ設定していない人は、下のリンクから「ログイン用のリンク」をメールで受け取る
export function renderLogin(root, title) {
  let mode = "password";
  root.innerHTML = `
    <section class="panel narrow login-card">
      <div class="emblem-lg" aria-hidden="true">ふ</div>
      <p class="en">LOGIN</p>
      <h1>${esc(title)}</h1>
      <p class="muted" data-pane="link" hidden>登録済みのメールアドレスに、ログイン用のリンクをお送りします。<br>ログインしたあと、右上のメールアドレスを押すとパスワードを設定できます。</p>
      <form id="login-form">
        <label>メールアドレス<input type="email" name="email" required autocomplete="username" placeholder="shop@example.com" /></label>
        <label data-pane="password">パスワード<input type="password" name="password" required autocomplete="current-password" minlength="8" /></label>
        <button class="btn" type="submit" id="login-btn">ログインする</button>
        <p class="form-msg" id="login-msg" role="status"></p>
      </form>
      <p class="small" style="margin-top:4px"><a href="#" id="login-toggle">パスワードをお忘れの方・まだ設定していない方はこちら</a></p>
      <p class="muted small">掲載のお申し込み・メールアドレスの登録は、<a href="../#inquiry">お問い合わせ</a>から運営にご連絡ください。</p>
    </section>`;
  const form = $("#login-form", root), msg = $("#login-msg", root), toggle = $("#login-toggle", root);
  const setMode = (m) => {
    mode = m;
    root.querySelectorAll("[data-pane]").forEach((el) => { el.hidden = el.dataset.pane !== mode; });
    form.password.required = mode === "password";
    $("#login-btn", root).textContent = mode === "password" ? "ログインする" : "ログイン用のリンクを送る";
    toggle.textContent = mode === "password" ? "パスワードをお忘れの方・まだ設定していない方はこちら" : "パスワードでログインする";
    msg.textContent = "";
  };
  toggle.addEventListener("click", (e) => { e.preventDefault(); setMode(mode === "password" ? "link" : "password"); });
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    if (mode === "password") {
      msg.textContent = "確認しています…";
      const { error } = await sb.auth.signInWithPassword({ email, password: form.password.value });
      msg.textContent = error ? "メールアドレスかパスワードが違います。パスワードを忘れた・まだ設定していない場合は、下の「こちら」からログインしてください。" : "";
      return;
    }
    msg.textContent = "送信しています…";
    const { error } = await sb.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname },
    });
    msg.textContent = error
      ? "送れませんでした。登録済みのメールアドレスか、ご確認ください。"
      : "メールを送りました。届いたリンクを押してください（数分かかることがあります。迷惑メールのフォルダもご確認ください）。";
  });
}

// パスワードの設定・変更（ヘッダーのメールアドレスを押すと開く）
function openAccount(user) {
  let dlg = document.getElementById("account-dlg");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "account-dlg";
    dlg.className = "account-dlg";
    document.body.append(dlg);
  }
  dlg.innerHTML = `
    <form method="dialog" class="account-form">
      <p class="en">ACCOUNT</p>
      <h2>パスワードの設定</h2>
      <p class="muted small">${esc(user.email || "")}<br>パスワードを設定すると、次からはメールを待たずにログインできます。ログイン用のリンクも今までどおり使えます。</p>
      <input type="text" name="username" value="${esc(user.email || "")}" autocomplete="username" hidden />
      <label>新しいパスワード（8文字以上）<input type="password" name="pw" minlength="8" required autocomplete="new-password" /></label>
      <label>もう一度<input type="password" name="pw2" minlength="8" required autocomplete="new-password" /></label>
      <p class="form-msg" role="status"></p>
      <div class="row"><button type="submit" class="btn" value="save">設定する</button><button type="button" class="btn-ghost" data-close>閉じる</button></div>
    </form>`;
  const f = dlg.querySelector("form"), m = dlg.querySelector(".form-msg");
  dlg.querySelector("[data-close]").onclick = () => dlg.close();
  f.onsubmit = async (e) => {
    e.preventDefault();
    if (f.pw.value !== f.pw2.value) return (m.textContent = "2回の入力が一致しません。");
    m.textContent = "設定しています…";
    const { error } = await sb.auth.updateUser({ password: f.pw.value });
    if (error) return (m.textContent = "設定できませんでした：" + error.message);
    dlg.close(); toast("パスワードを設定しました");
  };
  dlg.showModal();
}

// ヘッダーに、ログイン中のメールアドレスを出す
export function showWho(user) {
  const el = document.getElementById("who");
  if (!el || !user) return;
  el.textContent = user.email || user.id;
  el.title = `ログイン中：${user.email || ""}（ID ${user.id}）・押すとパスワードを設定できます`;
  el.hidden = false;
  el.onclick = () => openAccount(user);
}
