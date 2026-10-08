// 運営管理画面：問い合わせ・更新依頼・店の編集・オーナー招待・写真の非表示
import { sb, ready, $, esc, ZONES, PLANS, photoUrl, isPaid, fmtDate, callFn, toast, renderLogin, showWho } from "../lib/common.js?v=6";

const root = $("#root");
const TOWNS = ["大手", "順化", "中央", "つくも", "照手", "手寄", "日之出"];
const GENRES = ["和食", "寿司・海鮮", "そば・うどん", "ラーメン", "焼肉・肉料理", "焼鳥・串", "居酒屋", "イタリアン・フレンチ",
  "中華", "アジア・各国料理", "カフェ・スイーツ", "洋食", "バー", "スナック・ラウンジ", "その他"];
let tab = "requests";
let inqTrash = false;   // 問い合わせ：ゴミ箱を見ているか
let cat = "";   // 店・写真の区分：""=すべて / gourmet / night
const CATS = [["", "すべて"], ["gourmet", "グルメ"], ["night", "夜のお店"]];
const catSeg = () => `<div class="seg cat-seg" role="group" aria-label="区分">${CATS.map(([k, v]) => `<button type="button" data-cat="${k}" aria-pressed="${cat === k}">${v}</button>`).join("")}</div>`;
// 区分の切り替え（店・写真のタブ共通）。選んだ区分は両方のタブで引き継ぐ
function bindCat(pane, rerender) {
  pane.querySelector(".cat-seg").addEventListener("click", (e) => {
    const b = e.target.closest("[data-cat]"); if (!b) return;
    cat = b.dataset.cat; rerender();
  });
}

if (!ready) root.innerHTML = `<section class="panel narrow"><h1>Supabase が未設定です</h1><p class="muted">docs/config.js を設定してください。</p></section>`;
else {
  sb.auth.onAuthStateChange(async (_e, session) => {
    if (!session) return renderLogin(root, "運営管理にログイン");
    $("#logout").hidden = false;
    showWho(session.user);
    const { data: isAdmin } = await sb.rpc("is_admin");
    if (!isAdmin) return (root.innerHTML = `<section class="panel narrow"><h1>運営者ではありません</h1><p class="muted">${esc(session.user.email)} は運営者として登録されていません。</p></section>`);
    show();
  });
  $("#logout").addEventListener("click", async () => { await sb.auth.signOut(); location.reload(); });
}

async function show() {
  const [{ count: nReq }, { count: nInq }] = await Promise.all([
    sb.from("update_requests").select("id", { count: "exact", head: true }).eq("status", "open"),
    sb.from("inquiries").select("id", { count: "exact", head: true }).eq("status", "open").is("deleted_at", null),
  ]);
  root.innerHTML = `
    <div class="tabs" role="tablist">
      ${[["requests", `更新依頼${nReq ? `<span class="num">${nReq}</span>` : ""}`], ["inquiries", `問い合わせ${nInq ? `<span class="num">${nInq}</span>` : ""}`], ["shops", "店"], ["photos", "写真"]]
        .map(([k, v]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${v}</button>`).join("")}
    </div>
    <div id="pane"></div>`;
  root.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { tab = b.dataset.tab; show(); } });
  ({ requests: showRequests, inquiries: showInquiries, shops: showShops, photos: showPhotos })[tab]($("#pane"));
}

async function showRequests(pane) {
  const { data } = await sb.from("update_requests").select("*, shops(name, slug, id)").order("status").order("created_at", { ascending: false }).limit(100);
  pane.innerHTML = `<section class="panel"><h2><span class="en">REQUESTS</span>更新依頼</h2>${data?.length ? `<ul class="list">${data.map((r) => `
    <li data-id="${r.id}">
      <div class="spread"><strong>${esc(r.shops?.name)}</strong><span class="small muted">${fmtDate(r.created_at)}</span></div>
      <p style="white-space:pre-wrap;margin:6px 0">${esc(r.body)}</p>
      ${r.status === "open" ? `<div class="row">
        <input data-note placeholder="オーナーへのひとこと（任意）" style="flex:1;min-width:180px" />
        <button class="btn" data-set="done">反映した</button><button class="btn-ghost" data-set="rejected">見送り</button>
        <button class="btn-ghost" data-open="${r.shop_id}">店を開く</button></div>`
        : `<span class="badge ${r.status === "done" ? "paid" : "off"}">${r.status === "done" ? "反映済み" : "見送り"}</span> <span class="small muted">${esc(r.admin_note)}</span>`}
    </li>`).join("")}</ul>` : '<p class="muted">依頼はありません。</p>'}</section>`;
  pane.addEventListener("click", async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.open) { tab = "shops"; await show(); return openShop($("#pane"), b.dataset.open); }
    const li = b.closest("li");
    const { error } = await sb.from("update_requests").update({ status: b.dataset.set, admin_note: $("[data-note]", li).value.trim(), handled_at: new Date().toISOString() }).eq("id", li.dataset.id);
    error ? toast(error.message, "error") : show();
  });
}

const KIND = { owner: "店舗会員の申し込み", fix: "掲載内容の修正依頼", remove: "掲載の取りやめ", closed: "閉店・移転の情報", other: "その他" };
// 招待メールのリンクの戻り先：お店の管理画面（このフォルダと同じ階層の owner/）
const inviteTo = () => new URL("../owner/", location.href).href;

async function showInquiries(pane) {
  // 削除するとゴミ箱へ（deleted_at に日時が入る）。ゴミ箱から元に戻すか、完全に削除できる
  let q = sb.from("inquiries").select("*, shops(id, name, slug, tel, town)");
  q = inqTrash ? q.not("deleted_at", "is", null).order("deleted_at", { ascending: false })
               : q.is("deleted_at", null).order("status").order("created_at", { ascending: false });
  const [{ data }, { count: nTrash }] = await Promise.all([
    q.limit(100),
    sb.from("inquiries").select("id", { count: "exact", head: true }).not("deleted_at", "is", null),
  ]);
  const acts = (r) => inqTrash
    ? `<button class="btn-ghost" data-restore>元に戻す</button><button class="btn-ghost danger" data-purge>完全に削除</button>
       <span class="small muted">${fmtDate(r.deleted_at)} にゴミ箱へ</span>`
    : r.status === "open"
      ? '<button class="btn-ghost" data-done>対応済みにする</button>'   // 未対応のものはゴミ箱に入れられない（対応漏れを防ぐ）
      : '<span class="badge paid">対応済み</span><button class="btn-ghost danger" data-trash>ゴミ箱へ</button>';
  // 店舗会員の申し込み：対象の店を決めて、そのまま招待メールを送れる
  const ownerBox = (r) => {
    if (inqTrash || r.kind !== "owner" || r.status !== "open") return "";
    const email = (r.contact.match(/[^\s／]+@[^\s／]+/) || [""])[0];   // 連絡先は「メール ／ 電話 ○○」の形
    const shop = r.shops
      ? `<p class="small">対象のお店：<strong>${esc(r.shops.name)}</strong>（${esc(r.shops.town || "")}）${r.shops.tel ? ` ／ 店の電話：<a href="tel:${esc(r.shops.tel)}">${esc(r.shops.tel)}</a>` : " ／ 店の電話：未登録"}
          <a class="small" href="../#/shop/${encodeURIComponent(r.shops.slug)}" target="_blank">公開ページ</a>
          <button class="icon-btn" data-unpick>別の店にする</button></p>
         <div class="row" style="align-items:flex-end">
           <label style="flex:1;min-width:220px">招待するメールアドレス<input type="email" data-invite-email value="${esc(email)}" /></label>
           <button class="btn" data-invite>このお店に招待する</button></div>
         <p class="muted small">店の電話や公式アカウントの DM で、申し込んだ方がお店の方かを確かめてから招待してください。招待すると、この問い合わせは対応済みになります。</p>`
      : `<p class="small">対象のお店がまだ決まっていません。店名で探して選んでください。</p>
         <label>お店を探す<input data-shop-q value="${esc(r.shop_name)}" /></label><div class="row" data-shop-hits></div>`;
    return `<div class="owner-box">${shop}</div>`;
  };
  pane.innerHTML = `<section class="panel"><div class="spread"><h2><span class="en">${inqTrash ? "TRASH" : "INQUIRIES"}</span>${inqTrash ? "ゴミ箱" : "掲載の問い合わせ"}</h2>
      <button class="btn-ghost" data-toggle-trash>${inqTrash ? "← 問い合わせ一覧へ" : `ゴミ箱${nTrash ? `（${nTrash}件）` : ""}`}</button></div>
    ${data?.length ? `<ul class="list">${data.map((r) => `
    <li data-id="${r.id}"><div class="spread"><span><span class="badge${r.kind === "owner" ? " warn" : ""}">${esc(KIND[r.kind] || "その他")}</span> <strong>${esc(r.shop_name)}</strong></span><span class="small muted">${fmtDate(r.created_at)}</span></div>
      <p class="small">連絡先：${esc(r.contact)}</p><p style="white-space:pre-wrap;margin:4px 0">${esc(r.message)}</p>
      ${ownerBox(r)}
      <div class="row">${acts(r)}</div></li>`).join("")}</ul>` : `<p class="muted">${inqTrash ? "ゴミ箱は空です。" : "問い合わせはありません。"}</p>`}</section>`;
  // 店名で探す（ふりがなでも）
  const search = async (input) => {
    const w = input.value.trim().replace(/[,()*%\\]/g, " ").trim(), box = input.closest("li").querySelector("[data-shop-hits]");
    if (!w) { box.innerHTML = ""; return; }
    const { data: hits } = await sb.from("shops").select("id, name, town").or(`name.ilike.*${w}*,kana.ilike.*${w}*`).limit(8);
    box.innerHTML = (hits || []).map((h) => `<button class="btn-ghost" data-pick-shop="${h.id}">${esc(h.name)}<span class="small muted">（${esc(h.town || "")}）</span></button>`).join("") || '<span class="small muted">見つかりません。</span>';
  };
  pane.querySelectorAll("[data-shop-q]").forEach((i) => search(i));
  let timer;
  pane.oninput = (e) => { if (e.target.matches("[data-shop-q]")) { clearTimeout(timer); timer = setTimeout(() => search(e.target), 250); } };
  pane.onclick = async (e) => {
    const b = e.target.closest("button"); if (!b) return;
    if ("toggleTrash" in b.dataset) { inqTrash = !inqTrash; return show(); }
    const li = b.closest("li"); if (!li) return;
    const id = li.dataset.id, name = li.querySelector("strong").textContent;
    let res;
    if (b.dataset.pickShop) { res = await sb.from("inquiries").update({ shop_id: b.dataset.pickShop }).eq("id", id); if (res.error) return toast(res.error.message, "error"); return show(); }
    if ("unpick" in b.dataset) { res = await sb.from("inquiries").update({ shop_id: null }).eq("id", id); if (res.error) return toast(res.error.message, "error"); return show(); }
    if ("invite" in b.dataset) {
      const r = data.find((x) => x.id === id), email = li.querySelector("[data-invite-email]").value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return toast("メールアドレスを確かめてください。", "error");
      if (!confirm(`「${r.shops.name}」に ${email} を招待します。お店の方であることは確認できましたか？`)) return;
      b.disabled = true;
      try { await callFn("invite-owner", { shop_id: r.shops.id, email, redirect_to: inviteTo() }); }
      catch (err) { b.disabled = false; return toast("送れませんでした：" + err.message, "error"); }
      await sb.from("inquiries").update({ status: "done" }).eq("id", id);
      toast("招待メールを送りました。"); return show();
    }
    if ("done" in b.dataset) res = await sb.from("inquiries").update({ status: "done" }).eq("id", id);
    else if ("trash" in b.dataset) res = await sb.from("inquiries").update({ deleted_at: new Date().toISOString() }).eq("id", id).eq("status", "done");
    else if ("restore" in b.dataset) res = await sb.from("inquiries").update({ deleted_at: null }).eq("id", id);
    else if ("purge" in b.dataset) {
      if (!confirm(`「${name}」の問い合わせを完全に削除します。元に戻せません。よろしいですか？`)) return;
      res = await sb.from("inquiries").delete().eq("id", id);
    } else return;
    if (res.error) return toast("できませんでした：" + res.error.message);
    toast("trash" in b.dataset ? "ゴミ箱に移しました" : "restore" in b.dataset ? "元に戻しました" : "purge" in b.dataset ? "完全に削除しました" : "対応済みにしました");
    show();
  };
}

async function showShops(pane) {
  pane.innerHTML = `<section class="panel"><div class="spread"><h2><span class="en">SHOPS</span>店を探す</h2>${catSeg()}</div>
    <div class="row"><input id="shop-q" placeholder="店名・ふりがなで検索" style="flex:1" />
      <select id="shop-f"><option value="">すべて</option><option value="paid">有料</option><option value="hidden">非表示</option><option value="members">オーナーあり</option><option value="gcheck">Google 要確認</option></select>
      <button class="btn-ghost" id="shop-new">店を追加</button></div>
    <div id="shop-results" style="margin-top:10px"></div></section><div id="shop-edit"></div>`;
  const run = async () => {
    let q = sb.from("shops").select("id,name,zone,town,genre,category,plan,plan_until,is_hidden,google_check,google_place_id,shop_members(email)").order("name").limit($("#shop-f").value === "gcheck" ? 400 : 50);
    const v = $("#shop-q").value.trim(), f = $("#shop-f").value;
    if (cat) q = q.eq("category", cat);
    pane.querySelectorAll(".cat-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.cat === cat)));
    // 店名かふりがなで探す（カタカナで入れてもひらがなに直して探す）
    if (v) {
      const w = v.replace(/[,()"\\%*]/g, "");
      const hira = w.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
      q = q.or(`name.ilike.*${w}*,kana.ilike.*${hira}*`);
    }
    if (f === "paid") q = q.neq("plan", "free");
    if (f === "hidden") q = q.eq("is_hidden", true);
    if (f === "gcheck") q = q.eq("google_check", "要確認").eq("is_hidden", false);
    const { data, error } = await q;
    if (error) return toast(error.message, "error");
    const rows = f === "members" ? data.filter((s) => s.shop_members.length) : data;
    $("#shop-results").innerHTML = `${f === "gcheck" ? `<p class="small muted">${rows.length} 件。Google の候補が同じ店か確かめきれなかったお店です。店を開いて「Google の星」で決めてください。</p>` : ""}<table class="grid"><tbody>${rows.map((s) => `
      <tr><td><a href="#" data-open="${s.id}">${esc(s.name)}</a></td><td class="small nw">${s.category === "night" ? "夜" : "グルメ"}・${esc(ZONES[s.zone])}・${esc(s.town)}</td>
      <td class="small">${isPaid(s) ? '<span class="badge paid">有料</span>' : ""}${s.is_hidden ? '<span class="badge off">非表示</span>' : ""}${s.google_check ? '<span class="badge off">Google 要確認</span>' : s.google_place_id ? " ★" : ""}${s.shop_members.length ? ` 👤${s.shop_members.length}` : ""}</td></tr>`).join("")}</tbody></table>`;
  };
  let t; $("#shop-q").addEventListener("input", () => { clearTimeout(t); t = setTimeout(run, 250); });
  $("#shop-f").addEventListener("change", run);
  $("#shop-results").addEventListener("click", (e) => { const a = e.target.closest("[data-open]"); if (a) { e.preventDefault(); openShop(pane, a.dataset.open); } });
  $("#shop-new").addEventListener("click", () => openShop(pane, null));
  bindCat(pane, run);
  run();
}

// Google の口コミの星（代表の指示 2026-10-08）。保存してよいのは place_id だけなので、候補は Google マップで開いて確かめる
const gmap = (pid) => `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(pid)}`;
function googleBox(s) {
  const st = s.google_place_id ? "星を表示中" : s.google_check === "要確認" ? "要確認（Google の候補が同じ店か分からない）" : s.google_check === "別の店" ? "別の店（星は出さない）" : "Google の店が見つかっていない";
  return `<h3>Google の星</h3>
    <p class="small">${esc(st)}
      ${s.google_place_id ? ` <a href="${gmap(s.google_place_id)}" target="_blank" rel="noopener">Google マップで見る</a>` : ""}
      ${!s.google_place_id && s.google_candidate_id ? ` <a href="${gmap(s.google_candidate_id)}" target="_blank" rel="noopener">候補を Google マップで見る</a>` : ""}</p>
    <div class="row">
      ${!s.google_place_id && s.google_candidate_id ? '<button type="button" class="btn-ghost" data-gset="same">同じ店（星を出す）</button><button type="button" class="btn-ghost" data-gset="other">別の店（星を出さない）</button>' : ""}
      ${s.google_place_id ? '<button type="button" class="btn-ghost" data-gset="off">星を出さない</button>' : ""}
    </div>`;
}

async function openShop(pane, id) {
  const box = $("#shop-edit", pane) || pane;
  let s = { name: "", kana: "", opened_on: null, zone: "ekimae", town: "中央", category: "gourmet", genre: "その他", instagram: "", plan: "free", plan_until: null, is_hidden: false, address: "", tel: "", admin_note: "" };
  let members = [];
  if (id) {
    const r = await sb.from("shops").select("*").eq("id", id).single(); s = r.data;
    members = (await sb.from("shop_members").select("*").eq("shop_id", id)).data || [];
  }
  const opt = (list, v) => list.map((x) => `<option ${x === v ? "selected" : ""}>${esc(x)}</option>`).join("");
  box.innerHTML = `<section class="panel">
    <h2>${id ? "店を編集" : "店を追加"}</h2>
    <form id="shop-form">
      <label>店名<input name="name" required value="${esc(s.name)}" /></label>
      <div class="row">
        <label style="flex:2">ふりがな（検索用・ひらがな）<input name="kana" value="${esc(s.kana || "")}" placeholder="例：そばどころ ふくふくあん" /></label>
        <label style="flex:1">オープン日（1年間「NEW」表示）<input name="opened_on" type="date" value="${esc(s.opened_on || "")}" /></label>
      </div>
      <div class="row">
        <label>エリア<select name="zone"><option value="ekimae" ${s.zone === "ekimae" ? "selected" : ""}>駅前</option><option value="katamachi" ${s.zone === "katamachi" ? "selected" : ""}>片町</option></select></label>
        <label>町<select name="town">${opt(TOWNS, s.town)}</select></label>
        <label>区分<select name="category"><option value="gourmet" ${s.category === "gourmet" ? "selected" : ""}>グルメ</option><option value="night" ${s.category === "night" ? "selected" : ""}>夜のお店</option></select></label>
        <label>ジャンル<select name="genre">${opt(GENRES, s.genre)}</select></label>
      </div>
      <label>Instagram（@ のあと）<input name="instagram" value="${esc(s.instagram)}" /></label>
      <div class="row">
        <label>プラン<select name="plan">${Object.entries(PLANS).map(([k, v]) => `<option value="${k}" ${s.plan === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
        <label>有料の期限<input name="plan_until" type="date" value="${s.plan_until ? s.plan_until.slice(0, 10) : ""}" /></label>
        <label class="row" style="margin-top:18px"><input type="checkbox" name="is_hidden" ${s.is_hidden ? "checked" : ""} /> 非表示（掲載拒否・閉店など）</label>
      </div>
      <p class="muted small">Stripe で契約した店のプランと期限は自動で更新されます。手で変えるのは、特別に無償で有料にする場合などだけにしてください。</p>
      <h3>運営だけが見る情報</h3>
      <label>住所<input name="address" value="${esc(s.address)}" /></label>
      <label>電話<input name="tel" value="${esc(s.tel)}" /></label>
      <label>メモ<textarea name="admin_note" rows="3">${esc(s.admin_note)}</textarea></label>
      ${id ? googleBox(s) : ""}
      <button class="btn" type="submit">保存する</button>
      ${id ? `<a class="small" href="../#/shop/${encodeURIComponent(s.slug)}" target="_blank" style="margin-left:10px">公開ページ</a>` : ""}
    </form>
    ${id ? `<h3>オーナー（ログインできる人）</h3>
      <ul class="list">${members.map((m) => `<li class="spread"><span>${esc(m.email)} <span class="small muted">${fmtDate(m.invited_at)} 招待</span></span>
        <button class="icon-btn danger" data-unlink="${m.user_id}">紐付けを外す</button></li>`).join("") || '<li class="muted">まだいません。</li>'}</ul>
      <form id="invite-form" class="row" style="margin-top:10px;align-items:flex-end">
        <label style="flex:1;min-width:220px">メールアドレスを紐付けて招待<input type="email" name="email" required /></label>
        <button class="btn" type="submit">招待メールを送る</button></form>
      <p class="muted small">お店の公式アカウントの DM や店の電話で確認したアドレスだけを登録してください。招待されたメールのリンクを押すと、この店の管理画面に入れます。</p>` : ""}
  </section>`;
  box.scrollIntoView({ behavior: "smooth" });

  $("#shop-form", box).addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    const row = {
      name: f.name.value.trim(), kana: f.kana.value.trim(), opened_on: f.opened_on.value || null, zone: f.zone.value, town: f.town.value, category: f.category.value, genre: f.genre.value,
      instagram: f.instagram.value.trim().replace(/^@/, ""), plan: f.plan.value,
      plan_until: f.plan_until.value ? new Date(f.plan_until.value + "T23:59:59+09:00").toISOString() : null,
      is_hidden: f.is_hidden.checked, address: f.address.value.trim(), tel: f.tel.value.trim(), admin_note: f.admin_note.value,
    };
    if (row.instagram !== (s.instagram || "")) row.instagram_from = "admin";
    const res = id ? await sb.from("shops").update(row).eq("id", id) : await sb.from("shops").insert({ ...row, slug: "s" + crypto.randomUUID().slice(0, 8) }).select().single();
    if (res.error) return toast(res.error.message, "error");
    toast("保存しました。");
    if (!id) openShop(pane, res.data.id);
  });
  box.querySelectorAll("[data-gset]").forEach((b) => b.addEventListener("click", async () => {
    const v = b.dataset.gset;
    const row = v === "same" ? { google_place_id: s.google_candidate_id, google_check: null }
      : v === "other" ? { google_check: "別の店", google_place_id: null }
      : { google_candidate_id: s.google_place_id, google_place_id: null, google_check: "別の店" };
    const { error } = await sb.from("shops").update(row).eq("id", id);
    if (error) return toast(error.message, "error");
    toast(v === "same" ? "Google の星を出すようにしました。" : "Google の星は出さないようにしました。"); openShop(pane, id);
  }));
  $("#invite-form", box)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button"); btn.disabled = true;
    try {
      await callFn("invite-owner", { shop_id: id, email: e.target.email.value.trim(), redirect_to: inviteTo() });
      toast("招待メールを送りました。"); openShop(pane, id);
    } catch (err) { toast("送れませんでした：" + err.message, "error"); btn.disabled = false; }
  });
  box.querySelectorAll("[data-unlink]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("このメールアドレスの紐付けを外しますか？")) return;
    await sb.from("shop_members").delete().eq("shop_id", id).eq("user_id", b.dataset.unlink); openShop(pane, id);
  }));
}

async function showPhotos(pane) {
  const { data } = await sb.from("shop_photos").select("*, shops(name, category)").order("created_at", { ascending: false }).limit(200);
  const rows = (data || []).filter((p) => !cat || p.shops?.category === cat).slice(0, 60);
  pane.innerHTML = `<section class="panel"><div class="spread"><h2><span class="en">PHOTOS</span>新しい写真</h2>${catSeg()}</div>
    <p class="muted small">問題のある写真は「非表示」にすると、公開ページから消えます（オーナーには「運営により非表示」と出ます）。</p>
    <div class="photos">${rows.map((p) => `<div class="photo" data-id="${p.id}"><img src="${esc(photoUrl(p.path))}" alt="" loading="lazy" />
      <div class="tools"><span class="small">${esc(p.shops?.name)}</span><span class="small muted">${p.shops?.category === "night" ? "夜" : "グルメ"}・${fmtDate(p.created_at)}</span>
      <button class="icon-btn ${p.is_hidden ? "" : "danger"}" data-hide="${p.is_hidden ? 0 : 1}">${p.is_hidden ? "表示に戻す" : "非表示にする"}</button></div></div>`).join("") || '<p class="muted">写真はまだありません。</p>'}</div></section>`;
  bindCat(pane, () => showPhotos(pane));
  pane.querySelector(".photos").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-hide]"); if (!b) return;
    await sb.from("shop_photos").update({ is_hidden: b.dataset.hide === "1" }).eq("id", b.closest(".photo").dataset.id); showPhotos(pane);
  });
}
