// お店の管理画面（オーナー用）
// 無料：更新依頼を送る / 有料：店の情報・写真（5枚）・リンク（10件）を直接編集
import { sb, ready, cfg, $, esc, ZONES, PLANS, LINK_KINDS, photoUrl, isPaid, fmtDate, shrinkImage, callFn, toast, renderLogin, showWho } from "../lib/common.js?v=6";

const root = $("#root");
const MAX_PHOTOS = 5, MAX_LINKS = 10;
const PERKS = [
  "お店の情報をこの画面から直接編集",
  "写真を5枚まで掲載（一覧ではトップ写真つきで表示）",
  "ひとこと・紹介文・営業時間・定休日・電話番号を掲載（電話番号はタップで電話）",
  "ホームページ・食べログ・予約ページなど、リンクを10件まで",
  "一覧で上のほうに表示（PR表記つき）",
  "Threads @" + (cfg.threads || "fukui_ekimae") + " での紹介投稿（PR表記つき）",
];

if (!ready) {
  root.innerHTML = `<section class="panel narrow"><h1>ただいま準備中です</h1><p class="muted">お店の管理画面は近日公開予定です。</p></section>`;
} else {
  sb.auth.onAuthStateChange((_e, session) => (session ? showShops(session) : renderLogin(root, "お店の管理画面にログイン")));
  $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });
}

let current = null;   // { session, shops }

async function showShops(session) {
  $("#logout").hidden = false;
  showWho(session.user);
  const { data: members, error } = await sb.from("shop_members").select("shop_id").eq("user_id", session.user.id);
  if (error) return (root.innerHTML = `<p class="panel">読み込めませんでした：${esc(error.message)}</p>`);
  if (!members.length) {
    root.innerHTML = `<section class="panel narrow"><h1>お店が紐付いていません</h1>
      <p class="muted">${esc(session.user.email)} に紐付いたお店がありません。運営にお問い合わせください。</p></section>`;
    return;
  }
  const ids = members.map((m) => m.shop_id);
  const { data: shops } = await sb.from("shops").select("*").in("id", ids).order("name");
  current = { session, shops };
  const want = new URLSearchParams(location.search).get("shop");
  const shop = shops.find((s) => s.id === want) || shops[0];
  render(shop);
  const checkout = new URLSearchParams(location.search).get("checkout");
  if (checkout === "success") toast("お申し込みありがとうございます。反映まで少しお待ちください。");
  if (checkout === "cancel") toast("お申し込みを取りやめました。");
}

async function render(shop) {
  const { shops } = current;
  const paid = isPaid(shop);
  const { data: sub } = await sb.from("subscriptions").select("*").eq("shop_id", shop.id).maybeSingle();
  current.sub = sub;
  // 契約中か（サイトに非表示のお店でも、契約と解約の操作は見せる）
  const contracted = shop.plan !== "free" && (!shop.plan_until || new Date(shop.plan_until) > new Date());
  const canceling = contracted && sub && sub.cancel_at && ["active", "trialing", "past_due"].includes(sub.status);
  const nextDate = sub && ["active", "trialing", "past_due"].includes(sub.status) && sub.current_period_end ? sub.current_period_end : shop.plan_until;
  root.innerHTML = `
    ${shops.length > 1 ? `<section class="panel"><p class="small" style="margin:0 0 8px"><b>このメールアドレスで管理できるお店（${shops.length}店）</b>　押すと切り替わります</p>
      <div class="row" style="flex-wrap:wrap;gap:8px">${shops.map((s) => `<button type="button" class="${s.id === shop.id ? "btn" : "btn-ghost"}" data-shop="${s.id}" ${s.id === shop.id ? 'aria-current="true"' : ""}>${esc(s.name)}</button>`).join("")}</div></section>` : ""}
    <section class="panel">
      <div class="shop-hero">
        <div class="thumb" id="shop-thumb">${shop.category === "night" ? "🍸" : "🍴"}</div>
        <div style="min-width:0;flex:1">
          <div class="row"><span class="badge ${contracted ? "paid" : ""}">${contracted ? PLANS[shop.plan] : "無料プラン"}</span>
            ${canceling ? '<span class="badge warn">解約済み（期間の終わりまで有効）</span>' : ""}
            ${shop.is_hidden ? '<span class="badge off">サイトに掲載していません</span>' : ""}
            ${sub && sub.status === "past_due" ? '<span class="badge warn">お支払いが確認できていません</span>' : ""}</div>
          <h1>${esc(shop.name)}</h1>
          <p class="muted">${esc(ZONES[shop.zone])}${shop.town ? "・" + esc(shop.town) : ""}　${esc(shop.genre)}</p>
        </div>
      </div>
      <div class="stats">
        <div><small>ご契約</small><b>${contracted ? esc(PLANS[shop.plan]) : "無料プラン"}</b>
          ${contracted ? "" : shop.is_hidden ? '<p class="muted small" style="margin:8px 0 0">サイトに掲載していないため、お申し込みはできません。運営にご連絡ください。</p>' : `${campaignNote(sub)}<button class="btn" data-plan="monthly" type="button" style="margin-top:8px;padding:8px 16px;font-size:.85rem">有料プランに申し込む</button>`}</div>
        <div><small>${canceling ? "有料プランの終了日" : sub?.status === "trialing" ? "無料期間の終わり（翌日からお支払い）" : "次回の更新日"}</small><b>${contracted && (canceling ? sub.cancel_at : nextDate) ? fmtDate(canceling ? sub.cancel_at : nextDate) : "—"}</b></div>
        <a class="see" href="../${location.search.includes("demo") ? "?demo=1" : ""}#/shop/${encodeURIComponent(shop.slug)}" target="_blank" rel="noopener">公開ページを見る →</a>
      </div>
      ${canceling ? `<p class="notice" style="margin-top:10px;padding:10px 14px;border-radius:12px;background:#fdecea;color:#8a1c12"><b>解約の手続きが済んでいます。</b>${fmtDate(sub.cancel_at)}で有料プランが終わり、無料掲載に戻ります。それまでは今までどおりご利用いただけます。<br><span class="small">取り消すときは「お支払い方法の変更・解約」から「サブスクを続ける」を押してください。</span></p>` : ""}
      ${contracted ? (sub ? '<p style="margin-top:10px"><button class="btn-ghost" id="portal" type="button">お支払い方法の変更・解約</button></p>' : '<p class="muted small" style="margin-top:10px">運営が設定した有料プランです。変更は運営にご連絡ください。</p>') : ""}
    </section>
    <div id="body"></div>`;
  document.querySelectorAll("[data-shop]").forEach((btn) => btn.addEventListener("click", () => {
    const next = shops.find((s) => s.id === btn.dataset.shop);
    const u = new URL(location.href); u.searchParams.set("shop", next.id); history.replaceState(null, "", u);
    render(next); window.scrollTo(0, 0);
  }));
  const body = $("#body");
  sb.from("shop_photos").select("path").eq("shop_id", shop.id).order("sort").limit(1).then(({ data }) => {
    if (paid && data?.[0]) $("#shop-thumb").style.backgroundImage = `url('${photoUrl(data[0].path)}')`, ($("#shop-thumb").textContent = "");
  });
  $("#portal")?.addEventListener("click", async (e) => {
    const b = e.currentTarget, label = b.textContent;
    b.disabled = true; b.classList.add("is-busy"); b.textContent = "Stripe の画面を開いています…";
    try { location.href = (await callFn("customer-portal", { shop_id: shop.id, return_url: location.href })).url; }
    catch (err) { toast("開けませんでした：" + err.message, "error"); b.disabled = false; b.classList.remove("is-busy"); b.textContent = label; }
  });
  if (paid) renderPaid(body, shop, sub);
  else renderFree(body, shop);
}

// キャンペーン（2026/10/31 までのお申し込みは最初の6か月無料。初めてのお申し込みだけ）
const CAMPAIGN_UNTIL = new Date("2026-10-31T23:59:59+09:00");
function campaignNote(sub) {
  if ((sub && sub.stripe_customer_id && sub.status !== "canceled") || Date.now() > CAMPAIGN_UNTIL.getTime()) return "";
  return '<p class="small" style="margin:8px 0 0;color:#8a1c12"><span style="font-weight:700">10月31日までのお申し込みは、最初の6か月無料</span>（7か月目からお支払い・いつでも解約できます）</p>';
}

// ───────── 無料プラン ─────────
async function renderFree(body, shop) {
  const { data: reqs } = await sb.from("update_requests").select("*").eq("shop_id", shop.id).order("created_at", { ascending: false }).limit(10);
  body.innerHTML = `
    <section class="panel">
      <h2><span class="en">REQUEST</span>掲載内容の更新依頼</h2>
      <p class="muted">店名・ジャンル・Instagram などを直したいときは、ここから運営に依頼してください。確認して反映します。</p>
      <form id="req-form">
        <label>直したい内容<textarea name="body" rows="5" maxlength="2000" required placeholder="例：Instagram のアカウントが変わりました。新しいアカウントは @xxxx です。"></textarea></label>
        <button class="btn" type="submit">依頼を送る</button>
      </form>
      ${reqs?.length ? `<h3>これまでの依頼</h3><ul class="list">${reqs.map((r) => `
        <li><div class="spread"><span class="small">${fmtDate(r.created_at)}</span>
          <span class="badge ${r.status === "done" ? "paid" : r.status === "rejected" ? "off" : ""}">${{ open: "確認中", done: "反映しました", rejected: "見送り" }[r.status]}</span></div>
          <p style="white-space:pre-wrap;margin:6px 0 0">${esc(r.body)}</p>
          ${r.admin_note ? `<p class="muted small">運営より：${esc(r.admin_note)}</p>` : ""}</li>`).join("")}</ul>` : ""}
    </section>
    ${shop.is_hidden || (shop.plan !== "free" && (!shop.plan_until || new Date(shop.plan_until) > new Date())) ? "" : upgradeSection(shop)}`;
  $("#req-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const { error } = await sb.from("update_requests").insert({ shop_id: shop.id, user_id: current.session.user.id, body: e.target.body.value.trim() });
    if (error) return toast("送れませんでした：" + error.message, "error");
    toast("依頼を送りました。");
    renderFree(body, shop);
  });
  bindUpgrade(shop);
}

function upgradeSection(shop) {
  return `
    <section class="panel" id="upgrade">
      <h2><span class="en">UPGRADE</span>有料プランにする</h2>
      <p class="muted">有料プランにすると、次のことができるようになります。</p>
      <ul class="perks">${PERKS.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>
      ${campaignNote(current.sub)}
      <button class="btn" data-plan="monthly" type="button" style="margin-top:14px">有料プランに申し込む</button>
      <p class="muted small">月額・年額（2か月分お得）は、お支払い画面（Stripe）で選べます。料金は、お支払い画面と<a href="../tokushoho.html" target="_blank">特定商取引法に基づく表記</a>でご確認いただけます。お支払いはクレジットカードです。いつでも解約でき、解約後も期間の終わりまでは有料プランのままです。
        <a href="../terms.html" target="_blank">利用規約</a>・<a href="../tokushoho.html" target="_blank">特定商取引法に基づく表記</a></p>
      <p class="form-msg" id="upgrade-msg" role="status"></p>
    </section>`;
}

function bindUpgrade(shop) {
  document.querySelectorAll("[data-plan]").forEach((b) => b.addEventListener("click", async () => {
    const msg = $("#upgrade-msg");
    const label = b.textContent;
    b.disabled = true; b.classList.add("is-busy"); b.textContent = "お支払い画面を開いています…"; msg.textContent = "お支払い画面を準備しています…";
    try {
      const { url } = await callFn("create-checkout", { shop_id: shop.id, plan: b.dataset.plan, return_url: location.origin + location.pathname });
      location.href = url;
    } catch (err) {
      msg.textContent = /not configured|準備中/.test(err.message) ? "お申し込みの受付は準備中です。もうしばらくお待ちください。" : "お支払い画面を開けませんでした：" + err.message;
      toast(msg.textContent, "error");
      b.disabled = false; b.classList.remove("is-busy"); b.textContent = label;
    }
  }));
}

// 詳しい情報（空欄はお店のページに出ない）
const DETAIL_FIELDS = [
  ["website", "公式ホームページ", "https://", 200, "url"],
  ["access", "アクセス", "例：福井駅西口から徒歩3分", 100],
  ["seats", "席数", "例：24席（カウンター8席）", 60],
  ["private_room", "個室・貸切", "例：個室あり（4名まで）・20名から貸切可", 100],
  ["reservation", "予約", "例：予約可・当日予約OK", 60],
  ["reservation_url", "予約ページの URL", "https://", 300, "url"],
  ["lunch", "ランチ", "例：あり（11:30〜14:00）", 60],
  ["budget_lunch", "予算（昼）", "例：1,000円", 30],
  ["budget_dinner", "予算（夜）", "例：4,000円", 30],
  ["course", "コース", "例：3,000円〜（飲み放題付き 5,000円〜）", 100],
  ["last_order", "ラストオーダー", "例：フード22:00 / ドリンク22:30", 60],
  ["smoking", "喫煙", "例：全席禁煙", 60],
  ["payment", "お支払い", "例：カード可・PayPay可", 100],
  ["solo_ok", "おひとりさま", "例：一人飲み歓迎", 60],
  ["kids_ok", "お子さま連れ", "例：お子さま連れOK", 60],
  ["takeout", "テイクアウト", "例：お弁当あり", 60],
];

// ───────── 有料プラン ─────────
async function renderPaid(body, shop, sub) {
  const [{ data: links }, { data: photos }] = await Promise.all([
    sb.from("shop_links").select("*").eq("shop_id", shop.id).order("sort"),
    sb.from("shop_photos").select("*").eq("shop_id", shop.id).order("sort"),
  ]);
  body.innerHTML = `
    <section class="panel">
      <h2><span class="en">PROFILE</span>お店の情報</h2>
      <form id="info-form">
        <label>ひとこと（40字まで・一覧に出ます）<input name="catch" maxlength="40" value="${esc(shop.catch)}" placeholder="例：駅前で21時から朝まで。一人飲み歓迎" /></label>
        <label>紹介文（400字まで）<textarea name="description" rows="6" maxlength="400">${esc(shop.description)}</textarea></label>
        <label>営業時間<input name="hours" maxlength="100" value="${esc(shop.hours)}" placeholder="例：18:00〜24:00（L.O. 23:30）" /></label>
        <label>定休日<input name="holiday" maxlength="100" value="${esc(shop.holiday)}" placeholder="例：日曜・祝日" /></label>
        <label>電話番号（お店のページに出ます。タップで電話がかかります。出したくないときは空に）<input name="tel" type="tel" maxlength="20" value="${esc(shop.tel)}" placeholder="例：0776-00-0000" /></label>
        <label>Instagram（@ のあと）<input name="instagram" maxlength="30" pattern="[A-Za-z0-9_.]*" value="${esc(shop.instagram)}" /></label>
        <h3 style="margin:18px 0 4px">詳しい情報 <small class="muted">（空欄の項目はお店のページに出ません）</small></h3>
        ${DETAIL_FIELDS.map(([k, label, ph, max, type]) => `<label>${label}<input name="${k}" maxlength="${max}" ${type === "url" ? 'type="url" pattern="https?://.*"' : ""} value="${esc(shop[k] || "")}" placeholder="${esc(ph)}" /></label>`).join("")}
        <button class="btn" type="submit">保存する</button>
      </form>
      <p class="muted small">店名・エリア・ジャンル・住所を変えたいときは、運営にご連絡ください。</p>
    </section>

    <section class="panel">
      <h2><span class="en">PHOTOS</span>写真（${photos.length}/${MAX_PHOTOS}枚）</h2>
      <p class="muted small">1枚目がトップ写真になります。写真は自動で縮小され、撮影場所などの情報は消えます。</p>
      <div class="photos" id="photos">${photos.map((p, i) => `
        <div class="photo" data-id="${p.id}">
          <img src="${esc(photoUrl(p.path))}" alt="${esc(p.caption)}" loading="lazy" />
          <div class="tools">
            ${p.is_hidden ? '<span class="badge off">運営により非表示</span>' : ""}
            <input data-caption value="${esc(p.caption)}" maxlength="60" placeholder="説明（例：名物のおでん）" />
            <div class="row">
              <button class="icon-btn" data-move="-1" ${i === 0 ? "disabled" : ""} aria-label="前へ">←</button>
              <button class="icon-btn" data-move="1" ${i === photos.length - 1 ? "disabled" : ""} aria-label="後ろへ">→</button>
              <button class="icon-btn danger" data-del>削除</button>
            </div>
          </div>
        </div>`).join("")}
        ${photos.length < MAX_PHOTOS ? `<label class="add-photo"><span>＋<br>写真を追加<br><small>あと${MAX_PHOTOS - photos.length}枚</small></span><input id="photo-input" type="file" accept="image/*" multiple hidden /></label>` : ""}</div>
      <p class="form-msg" id="photo-msg" role="status"></p>
    </section>

    <section class="panel">
      <h2><span class="en">LINKS</span>リンク（${links.length}/${MAX_LINKS}件）</h2>
      <ul class="list" id="links">${links.map((l, i) => `
        <li data-id="${l.id}"><div class="spread">
          <span><strong>${esc(l.label || LINK_KINDS[l.kind])}</strong><br><span class="small muted">${esc(l.url)}</span></span>
          <span class="row">
            <button class="icon-btn" data-lmove="-1" ${i === 0 ? "disabled" : ""} aria-label="上へ">↑</button>
            <button class="icon-btn" data-lmove="1" ${i === links.length - 1 ? "disabled" : ""} aria-label="下へ">↓</button>
            <button class="icon-btn danger" data-ldel>削除</button></span></div></li>`).join("")}</ul>
      ${links.length < MAX_LINKS ? `<form id="link-form" class="row" style="margin-top:10px;align-items:flex-end">
        <label>種類<select name="kind">${Object.entries(LINK_KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
        <label style="flex:1;min-width:200px">URL<input name="url" type="url" required pattern="https://.*" placeholder="https://" /></label>
        <label>表示名（任意）<input name="label" maxlength="20" /></label>
        <button class="btn" type="submit">追加</button></form>` : ""}
    </section>`;

  const reload = async () => {
    const { data } = await sb.from("shops").select("*").eq("id", shop.id).single();
    Object.assign(shop, data); renderPaid(body, shop, sub);
  };

  $("#info-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const { error } = await sb.from("shops").update({
      catch: f.catch.value.trim(), description: f.description.value.trim(), hours: f.hours.value.trim(),
      holiday: f.holiday.value.trim(), tel: f.tel.value.trim(), instagram: f.instagram.value.trim().replace(/^@/, ""),
      ...Object.fromEntries(DETAIL_FIELDS.map(([k]) => [k, f[k].value.trim()])),
    }).eq("id", shop.id);
    error ? toast("保存できませんでした：" + error.message, "error") : (toast("保存しました。"), reload());
  });

  $("#photo-input")?.addEventListener("change", async (e) => {
    const files = [...e.target.files].slice(0, MAX_PHOTOS - photos.length);
    const msg = $("#photo-msg");
    let sort = photos.length ? Math.max(...photos.map((p) => p.sort)) + 1 : 0;
    for (const [i, file] of files.entries()) {
      msg.textContent = `アップロードしています…（${i + 1}/${files.length}）`;
      try {
        const blob = await shrinkImage(file);
        const ext = blob.type === "image/webp" ? "webp" : "jpg";
        const path = `${shop.id}/${crypto.randomUUID()}.${ext}`;
        const up = await sb.storage.from("photos").upload(path, blob, { contentType: blob.type, cacheControl: "31536000" });
        if (up.error) throw up.error;
        const ins = await sb.from("shop_photos").insert({ shop_id: shop.id, path, sort: sort++ });
        if (ins.error) { await sb.storage.from("photos").remove([path]); throw ins.error; }
      } catch (err) { toast("アップロードできませんでした：" + err.message, "error"); break; }
    }
    msg.textContent = "";
    reload();
  });

  $("#photos").addEventListener("change", async (e) => {
    if (!e.target.matches("[data-caption]")) return;
    const id = e.target.closest(".photo").dataset.id;
    const { error } = await sb.from("shop_photos").update({ caption: e.target.value.trim() }).eq("id", id);
    error ? toast("保存できませんでした", "error") : toast("説明を保存しました。");
  });
  $("#photos").addEventListener("click", async (e) => {
    const btn = e.target.closest("button"); if (!btn) return;
    const id = btn.closest(".photo").dataset.id;
    const idx = photos.findIndex((p) => p.id === id);
    if ("del" in btn.dataset) {
      if (!confirm("この写真を削除しますか？")) return;
      await sb.from("shop_photos").delete().eq("id", id);
      await sb.storage.from("photos").remove([photos[idx].path]);
      return reload();
    }
    await swap("shop_photos", photos, idx, idx + Number(btn.dataset.move));
    reload();
  });

  $("#link-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const sort = links.length ? Math.max(...links.map((l) => l.sort)) + 1 : 0;
    const { error } = await sb.from("shop_links").insert({ shop_id: shop.id, kind: f.kind.value, url: f.url.value.trim(), label: f.label.value.trim(), sort });
    error ? toast("追加できませんでした：" + error.message, "error") : reload();
  });
  $("#links").addEventListener("click", async (e) => {
    const btn = e.target.closest("button"); if (!btn) return;
    const id = btn.closest("li").dataset.id;
    const idx = links.findIndex((l) => l.id === id);
    if ("ldel" in btn.dataset) { await sb.from("shop_links").delete().eq("id", id); return reload(); }
    await swap("shop_links", links, idx, idx + Number(btn.dataset.lmove));
    reload();
  });

}

// 並び順を入れ替える（a と b の sort を交換）
async function swap(table, items, a, b) {
  if (b < 0 || b >= items.length) return;
  const sa = items[a].sort === items[b].sort ? a : items[a].sort, sb_ = items[a].sort === items[b].sort ? b : items[b].sort;
  await sb.from(table).update({ sort: sb_ }).eq("id", items[a].id);
  await sb.from(table).update({ sort: sa }).eq("id", items[b].id);
}
