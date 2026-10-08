// ふくいエキマエ — 公開サイト
// データは Supabase の public_shops ビュー（未設定なら data/shops.json）。ログインは不要。
(() => {
  const cfg = window.FUKUFUKU_CONFIG || {};
  const hasDb = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey);
  const PAGE = 30;
  // ジャンルの色鉛筆アイコン（docs/img/genre/）
  const GENRE_IMG = {
    "和食": "washoku", "寿司・海鮮": "sushi", "そば・うどん": "soba", "ラーメン": "ramen", "焼肉・肉料理": "yakiniku",
    "焼鳥・串": "yakitori", "居酒屋": "izakaya", "イタリアン・フレンチ": "italian", "中華": "chuka", "アジア・各国料理": "asia",
    "カフェ・スイーツ": "cafe", "洋食": "yoshoku", "バー": "bar", "スナック・ラウンジ": "snack", "その他": "other",
  };
  const gicon = (g) => `<img class="gi" src="./img/genre/${GENRE_IMG[g] || "other"}.webp" alt="" width="48" height="48" loading="lazy" decoding="async" />`;
  const ZONES = { ekimae: "駅前", katamachi: "片町" };
  const SHORT = { "寿司・海鮮": "寿司", "そば・うどん": "そば", "焼肉・肉料理": "焼肉", "焼鳥・串": "焼鳥", "イタリアン・フレンチ": "洋風",
    "アジア・各国料理": "各国", "カフェ・スイーツ": "カフェ", "スナック・ラウンジ": "スナック" };
  // 「きょうの気分」：選ぶとジャンル（とエリア）で絞り込む
  const MOODS = {
    day: [
      { id: "lunch", icon: "🍱", label: "お昼ごはん", sub: "定食・そば・麺", genres: ["和食", "そば・うどん", "ラーメン", "洋食", "中華", "寿司・海鮮"] },
      { id: "cafe", icon: "☕", label: "ひと休み", sub: "カフェ・スイーツ", genres: ["カフェ・スイーツ"] },
      { id: "party", icon: "🍻", label: "みんなで飲み会", sub: "居酒屋・焼鳥", genres: ["居酒屋", "焼鳥・串", "焼肉・肉料理"] },
      { id: "special", icon: "✨", label: "ちょっといい店", sub: "洋風・寿司・和食", genres: ["イタリアン・フレンチ", "寿司・海鮮", "アジア・各国料理"] },
    ],
    night: [
      { id: "bar", icon: "🍸", label: "しっぽりバー", sub: "カクテル・洋酒", genres: ["バー"] },
      { id: "snack", icon: "🎤", label: "歌えるスナック", sub: "カラオケ・ママ", genres: ["スナック・ラウンジ"] },
      { id: "ekimae", icon: "🚉", label: "駅前で一杯", sub: "電車前にさくっと", zone: "ekimae" },
      { id: "katamachi", icon: "🏮", label: "片町ではしご", sub: "二軒目・三軒目に", zone: "katamachi" },
    ],
  };
  const svg = (id) => `<svg class="i"><use href="#i-${id}"/></svg>`;
  const LINK_LABEL = {
    web: "ホームページ", tabelog: "食べログ", hotpepper: "ホットペッパー", gmap: "Googleマップ", x: "X",
    threads: "Threads", tiktok: "TikTok", line: "LINE", reserve: "予約", other: "リンク",
  };

  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const state = { mode: "day", zone: "", genre: "", mood: "", q: "", shown: PAGE, shops: [] };
  const currentMood = () => (MOODS[state.mode] || []).find((m) => m.id === state.mood);

  try {
    const saved = JSON.parse(localStorage.getItem("fukufuku") || "{}");
    if (saved.mode === "night" || saved.mode === "day") state.mode = saved.mode;
    if (saved.zone in ZONES) state.zone = saved.zone;
  } catch (_) { /* 保存できない環境では毎回初期値 */ }
  // ?mode=night&zone=katamachi のようなリンク（片町ガイドなど）から来たときは、それを優先する
  const qp = new URLSearchParams(location.search);
  if (qp.get("mode") === "night" || qp.get("mode") === "day") state.mode = qp.get("mode");
  if (qp.get("zone") in ZONES) state.zone = qp.get("zone");
  const remember = () => { try { localStorage.setItem("fukufuku", JSON.stringify({ mode: state.mode, zone: state.zone })); } catch (_) {} };

  // 見本（?demo=1）の写真は url を持つ。本番の写真は Supabase のパス。
  function photoUrl(p) {
    if (typeof p === "object") return p.url || photoUrl(p.path);
    const path = p;
    return `${cfg.supabaseUrl}/storage/v1/object/public/photos/${path.split("/").map(encodeURIComponent).join("/")}`;
  }
  function mapUrl(s) {
    const q = `${s.name} 福井市${s.town || ""}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
  }
  // tel: リンク用に、数字と + だけにする
  const telHref = (t) => String(t).replace(/[^0-9+]/g, "");
  function igUrl(h) { return `https://www.instagram.com/${encodeURIComponent(h)}/`; }

  // ---- Google の口コミの星。代表の指示 2026-10-08「Googleの口コミの星だけでいいかな」「全体に反映して」。place_id が登録されたお店だけ出る ----
  async function loadGoogle(slug) {
    const box = $("#g-block");
    if (!box || !hasDb) return;
    try {
      const res = await fetch(`${cfg.supabaseUrl}/functions/v1/google-place`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` },
        body: JSON.stringify({ slug }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const g = await res.json();
      if (!document.body.contains(box)) return;
      const n = Math.round(g.rating || 0);
      box.removeAttribute("aria-busy");
      box.innerHTML = g.rating == null ? "" : `<span class="g-label">Google の口コミ</span>
        <span class="g-rate">${g.rating}</span><span class="g-stars" aria-label="星 ${g.rating}">${"★".repeat(n)}${"☆".repeat(5 - n)}</span>
        <span class="g-count">${g.count || 0} 件</span>`;
    } catch (e) {
      box.removeAttribute("aria-busy");
      box.innerHTML = "";
    }
  }

  async function load() {
    if (hasDb) {
      // Supabase は 1 回に 1,000 件までしか返さないので、1,000 件ずつ続けて読む
      const rows = [], size = 1000;
      for (let from = 0; ; from += size) {
        const url = `${cfg.supabaseUrl}/rest/v1/public_shops?select=*&order=slug&offset=${from}&limit=${size}`;
        const res = await fetch(url, { headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}` } });
        if (!res.ok) throw new Error(`エラー ${res.status}`);
        const page = await res.json();
        rows.push(...page);
        if (page.length < size) return rows;
      }
    }
    const res = await fetch("./data/shops.json");
    if (!res.ok) throw new Error(`エラー ${res.status}`);
    return res.json();
  }

  // 並び：有料（PR）→ Instagram あり → 名前順。有料同士は毎日入れ替わる（偏り防止）。
  function sortShops(list) {
    const day = new Date().toISOString().slice(0, 10);
    const h = (s) => [...(s.slug + day)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    return list.sort((a, b) =>
      (b.is_paid - a.is_paid) || (a.is_paid && b.is_paid ? h(a) - h(b) : 0) ||
      (Boolean(b.instagram) - Boolean(a.instagram)) || a.name.localeCompare(b.name, "ja"));
  }

  // 検索用にそろえる：全角半角・大文字小文字・カタカナ/ひらがな・空白や記号の違いを無視する
  const fold = (t) => String(t || "").normalize("NFKC").toLowerCase()
    .replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/[\s・･&＆'’.,、。!！?？()（）「」\-\/]/g, "");
  function matchQ(s) {
    const words = state.q.normalize("NFKC").trim().split(/\s+/).map(fold).filter(Boolean);
    if (!words.length) return true;
    // 店名・ふりがな・ジャンル・町名のどこかに、入力した言葉がすべて含まれていれば表示（ひらがなでも探せる）
    const hay = s._hay || (s._hay = fold(`${s.name} ${s.kana || ""} ${s.genre} ${s.town}`) + " " + (s.kana || "").replace(/\s/g, ""));
    return words.every((w) => hay.includes(w));
  }

  // 1年以内にオープンしたお店は、オープン日を出す
  function openedLabel(s) {
    if (!s.opened_on) return "";
    // 日付は文字列のまま読む（見ている端末の時差で1日ずれないように）
    const [y, m, d] = String(s.opened_on).split("-").map(Number);
    const days = (Date.now() - Date.UTC(y, m - 1, d, -9)) / 86400000;   // 日本時間の0時から何日たったか
    if (!y || days < 0 || days > 365) return "";
    return `${y}年${m}月${d}日オープン`;
  }

  function filtered() {
    return state.shops.filter((s) =>
      (state.mode === "night" ? s.category === "night" : s.category === "gourmet") &&
      (!state.zone || s.zone === state.zone) &&
      (!state.genre || s.genre === state.genre) &&
      (!currentMood()?.genres || currentMood().genres.includes(s.genre)) &&
      matchQ(s));
  }

  function renderChips() {
    const mg = currentMood()?.genres;
    const pool = state.shops.filter((s) => (state.mode === "night" ? s.category === "night" : s.category === "gourmet") && (!mg || mg.includes(s.genre)));
    const counts = {};
    pool.forEach((s) => { counts[s.genre] = (counts[s.genre] || 0) + 1; });
    const genres = Object.keys(counts).sort((a, b) => (a === "その他") - (b === "その他") || counts[b] - counts[a]);
    if (state.genre && !counts[state.genre]) state.genre = "";
    $("#genre-chips").innerHTML = [`<button class="chip" data-genre="" aria-pressed="${!state.genre}">すべて</button>`]
      .concat(genres.map((g) => `<button class="chip" data-genre="${esc(g)}" aria-pressed="${state.genre === g}">${gicon(g)}${esc(g)}<small>${counts[g]}</small></button>`))
      .join("");
  }

  function stamp(s) {
    return `<span class="stamp" aria-hidden="true">${gicon(s.genre)}<small>${esc(SHORT[s.genre] || s.genre)}</small></span>`;
  }
  function area(s) {
    return `<span class="t-area">${svg("pin")}${esc(ZONES[s.zone] || "")}${s.town ? "・" + esc(s.town) : ""}</span>`;
  }
  function stub(s, full) {
    return `<div class="perf"></div><div class="stub">
      ${s.instagram ? `<a class="pill ig" href="${igUrl(s.instagram)}" target="_blank" rel="noopener">${svg("ig")}@${esc(s.instagram)}</a>` : ""}
      ${full ? ((s.is_paid && s.links) || []).map((l) => `<a class="pill" href="${esc(l.url)}" target="_blank" rel="noopener">${svg("link")}${esc(l.label || LINK_LABEL[l.kind] || "リンク")}</a>`).join("") : ""}
      <a class="pill" href="${mapUrl(s)}" target="_blank" rel="noopener">${svg("map")}地図</a>
    </div>`;
  }

  function card(s) {
    const top = s.is_paid && s.photos && s.photos[0];
    return `<li class="ticket${s.is_paid ? " is-pr" : ""}">
      <a class="t-link" href="#/shop/${encodeURIComponent(s.slug)}">
        ${top ? `<div class="t-photo" style="background-image:url('${esc(photoUrl(top))}')" role="img" aria-label="${esc(top.caption || s.name)}"></div>` : ""}
        <div class="t-main">
          ${stamp(s)}
          <div class="t-text">
            <div class="t-tags"><span class="kind"><i></i>${esc(s.genre)}</span>${openedLabel(s) ? `<span class="new-tag">NEW</span>` : ""}</div>
            <h3 class="t-title">${esc(s.name)}</h3>
            ${s.is_paid && s.catch ? `<p class="t-note">${esc(s.catch)}</p>` : ""}
            ${area(s)}
            ${openedLabel(s) ? `<p class="t-opened">${esc(openedLabel(s))}</p>` : ""}
          </div>
        </div>
      </a>
      ${stub(s, false)}
    </li>`;
  }

  // 昼と夜で、ロゴとファビコンを切り替える（夜は片町のイラスト）
  function setIcons(night) {
    const sfx = night ? "-night" : "";
    $("#logo-img").src = `./logo${sfx}-96.png`;
    $("#fav32").href = `./favicon${sfx}-32.png`;
    $("#fav64").href = `./favicon${sfx}-64.png`;
    $("#touch-icon").href = `./apple-touch-icon${sfx}.png`;
  }

  function renderList() {
    const night = state.mode === "night";
    document.body.dataset.mode = state.mode;
    setIcons(night);
    document.querySelectorAll("[data-mode]").forEach((b) => b.tagName === "BUTTON" && b.setAttribute("aria-pressed", String(b.dataset.mode === state.mode)));
    document.querySelectorAll("#zone-seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.zone === state.zone)));
    document.querySelector('meta[name="theme-color"]').content = night ? "#62448c" : "#0b0b0d";
    $("#ph-band").textContent = night ? "NIGHT" : "GOURMET";
    const now = new Date(), season = ["WINTER", "WINTER", "SPRING", "SPRING", "SPRING", "SUMMER", "SUMMER", "SUMMER", "AUTUMN", "AUTUMN", "AUTUMN", "WINTER"][now.getMonth()];
    $("#season").textContent = `${now.getFullYear()} ${season}`;
    $("#ph-title").textContent = night ? "夜のお店" : "グルメ";
    $("#ph-icon").setAttribute("href", night ? "#i-glass" : "#i-bowl");
    $("#lead").textContent = night ? "片町と駅前の、バー・スナック・ラウンジ。" : "福井駅前と片町で、きょう行くお店を。";
    const zoneName = state.zone ? ZONES[state.zone] : "駅前・片町";
    $("#sec-title").textContent = `${zoneName}の${state.genre || (night ? "夜のお店" : "お店")}`;
    renderChips();
    $("#moods").innerHTML = MOODS[state.mode].map((m) => `<button class="mood" data-mood="${m.id}" aria-pressed="${state.mood === m.id}">
      <span class="mood-ic" aria-hidden="true">${m.icon}</span><span class="mood-t"><b>${esc(m.label)}</b><small>${esc(m.sub)}</small></span></button>`).join("");
    const mood = currentMood();
    if (mood) $("#sec-title").textContent = mood.zone ? `「${mood.label}」のお店` : `${state.zone ? ZONES[state.zone] : "駅前・片町"}で「${mood.label}」`;
    const all = filtered();
    // 有料のお店は「PICK UP」（見出しに PR 表記）に写真つきで出し、下の一覧には無料のお店を並べる
    const picks = all.filter((s) => s.is_paid), list = all.filter((s) => !s.is_paid);
    $("#count").textContent = all.length;
    $("#pickup").hidden = !picks.length;
    $("#pick-cards").innerHTML = picks.map(card).join("");
    $("#cards").removeAttribute("aria-busy");
    $("#cards").innerHTML = list.length
      ? list.slice(0, state.shown).map(card).join("")
      : (picks.length ? "" : emptyState(night));
    $("#more").hidden = list.length <= state.shown;
    $("#more").textContent = `もっと見る（あと${Math.max(0, list.length - state.shown)}件）`;
  }

  // 条件に合うお店がないとき：条件をゆるめるボタンと、もう一方（グルメ／夜）に合うお店があればその案内
  function emptyState(night) {
    const other = night ? "day" : "night";
    const otherHits = state.q ? state.shops.filter((s) => s.category === (night ? "gourmet" : "night") && matchQ(s)).length : 0;
    const acts = [
      state.q || state.genre || state.zone || state.mood ? '<button type="button" class="go" data-reset>条件をすべて外す</button>' : "",
      otherHits ? `<button type="button" data-mode="${other}">${night ? "グルメ" : "夜のお店"}で「${esc(state.q)}」を見る（${otherHits}件）</button>` : "",
    ].join("");
    return `<li class="empty"><b>条件に合うお店が見つかりませんでした</b>
      <p>${state.q ? `「${esc(state.q)}」の書き方を変えるか、` : ""}エリアやジャンルを変えてみてください。</p>
      ${acts ? `<div class="empty-acts">${acts}</div>` : ""}</li>`;
  }

  function renderDetail(slug) {
    const s = state.shops.find((x) => x.slug === slug);
    const el = $("#detail");
    if (!s) {
      // 掲載をやめたお店や、URL の打ち間違い
      $("#app").hidden = true; el.hidden = false;
      el.innerHTML = `<button class="back" type="button" data-back>${svg("back")}一覧にもどる</button>
        <ul class="cards"><li class="empty"><b>このお店のページは見つかりませんでした</b>
        <p>掲載が終わったか、URL が変わった可能性があります。</p>
        <div class="empty-acts"><button type="button" class="go" data-reset>お店の一覧を見る</button></div></li></ul>`;
      return;
    }
    const night = s.category === "night";
    document.body.dataset.mode = night ? "night" : "day";
    setIcons(night);
    const photos = (s.is_paid && s.photos) || [];
    const links = (s.is_paid && s.links) || [];
    // 近くの同じジャンル（同じエリア・同じ区分）。有料のお店を先に。
    const near = state.shops.filter((x) => x.slug !== s.slug && x.category === s.category && x.zone === s.zone && x.genre === s.genre)
      .slice(0, 40).sort((a, b) => b.is_paid - a.is_paid).slice(0, 4);
    const info = [
      ["エリア", `${ZONES[s.zone] || ""}${s.town ? "・" + s.town : ""}`],
      ["ジャンル", s.genre],
      ...(openedLabel(s) ? [["オープン", openedLabel(s).replace("オープン", "")]] : []),
      // 空欄の項目は出さない。無料のお店の電話・定休日・住所は、出どころを確かめたものだけがビューから届く
      ...(s.is_paid && s.hours ? [["営業時間", s.hours]] : []),
      ...[["定休日", s.holiday], ["ラストオーダー", s.last_order], ["電話", s.tel], ["住所", s.address], ["アクセス", s.access],
        ["席数", s.seats], ["コース", s.course], ["ランチ", s.lunch], ["予算（ランチ）", s.budget_lunch], ["予算（ディナー）", s.budget_dinner],
        ["個室・貸切", s.private_room], ["予約", s.reservation], ["喫煙", s.smoking], ["支払い", s.payment],
        ["おひとり様", s.solo_ok], ["お子さま連れ", s.kids_ok], ["テイクアウト", s.takeout]]
        .filter(([, v]) => v && String(v).trim()),
    ];
    el.innerHTML = `
      <button class="back" type="button" data-back>${svg("back")}一覧にもどる</button>
      <article class="d-wrap${s.is_paid ? " is-pr" : ""}">
        ${photos.length ? `
        <div class="d-hero">
          <div class="d-slides" id="d-slides">${photos.map((p, i) => `<figure><img src="${esc(photoUrl(p))}" alt="${esc(p.caption || s.name)}" ${i ? 'loading="lazy"' : ""} />${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>`).join("")}</div>
          <span class="d-count" id="d-count">1 / ${photos.length}</span>
          ${photos.length > 1 ? `<div class="d-thumbs">${photos.map((p, i) => `<button type="button" data-slide="${i}" aria-label="${i + 1}枚目" aria-current="${i === 0}"><img src="${esc(photoUrl(p))}" alt="" loading="lazy" /></button>`).join("")}</div>` : ""}
        </div>` : ""}
        <header class="d-head">
          <p class="eyebrow"><span class="band">${night ? "NIGHT" : "GOURMET"}</span>${openedLabel(s) ? `<span class="new-tag">${esc(openedLabel(s))}</span>` : ""}</p>
          <div class="d-title">
            ${stamp(s)}
            <div><h1>${esc(s.name)}</h1>${s.is_paid && s.catch ? `<p class="d-catch">${esc(s.catch)}</p>` : ""}</div>
          </div>
        </header>
        <div class="d-actions">
          ${s.tel ? `<a class="d-btn tel" href="tel:${esc(telHref(s.tel))}">${svg("tel")}<span><b>電話する</b><small>${esc(s.tel)}</small></span></a>` : ""}
          ${s.instagram ? `<a class="d-btn ig" href="${igUrl(s.instagram)}" target="_blank" rel="noopener">${svg("ig")}<span><b>Instagram</b><small>@${esc(s.instagram)}</small></span></a>` : ""}
          ${s.website && /^https?:\/\//.test(s.website) && !links.some((l) => l.url === s.website) ? `<a class="d-btn" href="${esc(s.website)}" target="_blank" rel="noopener">${svg("link")}<span><b>公式サイト</b><small>${esc(s.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/.*$/, ""))}</small></span></a>` : ""}
          ${s.reservation_url && /^https?:\/\//.test(s.reservation_url) ? `<a class="d-btn" href="${esc(s.reservation_url)}" target="_blank" rel="noopener">${svg("link")}<span><b>予約する</b><small>予約ページ</small></span></a>` : ""}
          <a class="d-btn" href="${mapUrl(s)}" target="_blank" rel="noopener">${svg("map")}<span><b>地図で見る</b><small>Googleマップ</small></span></a>
          ${links.map((l) => `<a class="d-btn" href="${esc(l.url)}" target="_blank" rel="noopener">${svg("link")}<span><b>${esc(l.label || LINK_LABEL[l.kind] || "リンク")}</b><small>${esc(LINK_LABEL[l.kind] || "")}</small></span></a>`).join("")}
        </div>
        <p class="g-block" id="g-block" aria-busy="true"></p>
        ${s.is_paid && s.description ? `<section class="d-block"><h2><span class="en">MESSAGE</span>お店から</h2><p class="d-desc">${esc(s.description)}</p></section>` : ""}
        <section class="d-block">
          <h2><span class="en">INFO</span>店舗情報</h2>
          <dl class="d-info">${info.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${k === "電話" ? `<a href="tel:${esc(telHref(v))}">${esc(v)}</a>` : esc(v)}</dd></div>`).join("")}</dl>
          ${s.is_paid ? "" : '<p class="d-small">営業時間などの最新情報は、お店の公式アカウントでご確認ください。</p>'}
        </section>
      </article>
      ${s.is_paid ? "" : `
      <aside class="d-owner">
        <p class="eyebrow"><span class="band">FOR SHOPS</span></p>
        <h2>このお店の方へ</h2>
        <p>店舗会員登録をしていただくと、写真・紹介文・営業時間・予約ページなどを載せることができます。</p>
        <a class="btn" href="#inquiry" data-inq-shop="${esc(s.slug)}">店舗会員の登録を申し込む</a>
      </aside>`}
      ${near.length ? `
      <section class="d-near">
        <h2 class="sec"><span class="en">NEARBY</span>${esc(ZONES[s.zone])}の${esc(s.genre)}</h2>
        <ul class="cards">${near.map(card).join("")}</ul>
      </section>` : ""}`;
    $("#app").hidden = true;
    el.hidden = false;
    document.title = `${s.name}｜ふくいエキマエ`;
    window.scrollTo(0, 0);
    loadGoogle(s.slug);
    const slides = $("#d-slides");
    if (slides) {
      slides.addEventListener("scroll", () => {
        const i = Math.round(slides.scrollLeft / slides.clientWidth);
        $("#d-count").textContent = `${i + 1} / ${photos.length}`;
        el.querySelectorAll("[data-slide]").forEach((b) => b.setAttribute("aria-current", String(Number(b.dataset.slide) === i)));
      }, { passive: true });
    }
  }

  function route() {
    const m = location.hash.match(/^#\/shop\/(.+)$/);
    if (m) return renderDetail(decodeURIComponent(m[1]));
    $("#detail").hidden = true;
    $("#app").hidden = false;
    document.title = "福井駅前・片町のランチ・居酒屋とバー・スナック｜ふくいエキマエ";
    renderList();
  }

  document.addEventListener("click", (e) => {
    const el = e.target instanceof Element ? e.target : e.target.correspondingUseElement || e.target.parentNode;
    const t = el && el.closest ? el.closest("button") : null;
    if (!t) return;
    if (t.dataset.mode) {
      state.mode = t.dataset.mode; state.genre = ""; state.mood = ""; state.shown = PAGE; remember();
      if (location.hash.startsWith("#/shop/")) location.hash = "#/"; else renderList();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
    else if (t.dataset.act === "search") { if (location.hash.startsWith("#/shop/")) location.hash = "#/"; setTimeout(() => $("#q-m").focus(), 50); }
    else if (t.dataset.mood) {
      const m = MOODS[state.mode].find((x) => x.id === t.dataset.mood);
      const prev = currentMood();
      if (prev?.zone) state.zone = "";            // エリアの気分から離れるときは、エリアも戻す
      state.mood = state.mood === m.id ? "" : m.id;
      if (state.mood) { state.genre = ""; if (m.zone) state.zone = m.zone; }
      state.shown = PAGE; renderList();
      document.querySelector(".sec").scrollIntoView({ behavior: "smooth", block: "start" });
    }
    else if ("zone" in t.dataset && t.closest("#zone-seg")) { state.zone = t.dataset.zone; state.shown = PAGE; remember(); renderList(); }
    else if ("genre" in t.dataset) { state.genre = t.dataset.genre; state.shown = PAGE; renderList(); }
    else if ("reset" in t.dataset) {
      state.q = ""; state.genre = ""; state.zone = ""; state.mood = ""; state.shown = PAGE; remember();
      for (const id of ["#q", "#q-m"]) $(id).value = "";
      if (location.hash.startsWith("#/shop/")) location.hash = "#/"; else renderList();
    }
    else if (t.id === "more") { state.shown += PAGE; renderList(); }
    else if (t.dataset.slide) { const sl = $("#d-slides"); sl.scrollTo({ left: sl.clientWidth * Number(t.dataset.slide), behavior: "smooth" }); }
    else if ("back" in t.dataset) { history.length > 1 ? history.back() : (location.hash = "#/"); }
  });
  for (const id of ["#q", "#q-m"]) {
    $(id).addEventListener("input", (e) => {
      state.q = e.target.value; state.shown = PAGE;
      for (const other of ["#q", "#q-m"]) if (other !== id) $(other).value = state.q;
      if (location.hash.startsWith("#/shop/")) location.hash = "#/"; else renderList();
    });
  }
  // 「掲載について問い合わせる」（#inquiry）から来たときは、問い合わせフォームを開いてそこへ移る
  function openInquiry() {
    const d = $("#inquiry"); d.open = true;
    setTimeout(() => d.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  window.addEventListener("hashchange", () => (location.hash === "#inquiry" ? openInquiry() : route()));
  // 同じ #inquiry をもう一度押したときも、フォームへ移る
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element && e.target.closest('a[href="#inquiry"]');
    if (a && location.hash === "#inquiry") { e.preventDefault(); openInquiry(); }
  });

  // ページのいちばん上へ戻るボタン（少し下まで読んだら出す）
  const toTop = $("#to-top");
  const onScroll = () => { toTop.hidden = window.scrollY < 600; };
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  if (location.hash === "#inquiry") setTimeout(openInquiry, 300);

  // お問い合わせフォーム。「店舗会員の申し込み」を選ぶと、お立場も聞く（メールアドレスはログインに使う）
  const inqForm = $("#inquiry-form");
  let inqShopId = "";   // お店のページから来たときの店（店名を書き換えたら外す）
  function syncInquiryKind() {
    const owner = inqForm.kind.value === "owner";
    $("#owner-note").hidden = !owner;
    $("#role-field").hidden = !owner;
    inqForm.role.required = owner;
    $("#contact-label").textContent = owner ? "メールアドレス（必須・ログインに使います）" : "メールアドレス（必須）";
  }
  inqForm.addEventListener("change", (e) => { if (e.target.name === "kind") syncInquiryKind(); });
  inqForm.shop_name.addEventListener("input", () => { inqShopId = ""; });
  // 「店舗会員の登録を申し込む」（お店のページ）から来たら、店名と用件を入れておく
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element && e.target.closest("[data-inq-shop]");
    if (!a) return;
    const s = state.shops.find((x) => x.slug === a.dataset.inqShop);
    if (!s) return;
    inqForm.shop_name.value = s.name; inqShopId = s.id || "";
    inqForm.kind.value = "owner"; syncInquiryKind();
  }, true);
  function fillShopNames() {
    $("#shop-names").innerHTML = [...new Set(state.shops.map((s) => s.name))].map((n) => `<option value="${esc(n)}"></option>`).join("");
  }

  inqForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target, msg = $("#inquiry-msg"), btn = f.querySelector("button");
    if (!hasDb) { msg.textContent = "ただいま準備中です。Threads @fukui_ekimae の DM でご連絡ください。"; return; }
    btn.disabled = true; msg.textContent = "送信しています…";
    const kind = f.kind.value || "other", name = f.shop_name.value.trim();
    // 店名が一覧のお店と1件だけ一致すれば、その店として送る（管理画面からすぐ招待できる）
    const hits = state.shops.filter((s) => s.name === name && s.id);
    const shopId = inqShopId || (hits.length === 1 ? hits[0].id : null);
    const role = kind === "owner" ? f.role.value.trim() : "";
    const body = { kind, shop_id: shopId, shop_name: name, contact: [f.contact.value.trim(), f.tel.value.trim() && `電話 ${f.tel.value.trim()}`].filter(Boolean).join(" ／ "), message: ((role ? `【お名前・お立場】${role}\n` : "") + f.message.value.trim()).trim() };
    try {
      const res = await fetch(`${cfg.supabaseUrl}/rest/v1/inquiries`, {
        method: "POST",
        headers: { apikey: cfg.supabaseAnonKey, Authorization: `Bearer ${cfg.supabaseAnonKey}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      f.reset(); inqShopId = ""; syncInquiryKind();
      msg.textContent = kind === "owner" ? "送信しました。ご本人確認のうえ、ログインのご案内をメールでお送りします。" : "送信しました。運営から折り返しご連絡します。";
      if (window.gtag) window.gtag("event", "inquiry_submit", { kind });
    } catch (err) {
      msg.textContent = "送信できませんでした。時間をおいてもう一度お試しください。";
    } finally { btn.disabled = false; }
  });

  // ?demo=1 のときだけ、有料掲載の見本（架空の店）を混ぜて表示する。本番の一覧には出さない。
  const demo = new URLSearchParams(location.search).has("demo");
  const loadDemo = () => (demo ? fetch("./demo/shops.json?v=2").then((r) => r.json()) : Promise.resolve([]));
  if (demo) {
    const bar = document.createElement("div");
    bar.className = "demo-bar";
    bar.innerHTML = '<b>見本</b>を表示中（架空のお店）・<a href="./demo/credits.html">写真クレジット</a>';
    document.body.prepend(bar);
  }

  Promise.all([load(), loadDemo()])
    .then(([rows, extra]) => {
      // Google 表示の試験用の複製は一覧に出さない（URL を知っている人だけが開ける）
      state.shops = sortShops(extra.concat(rows));
      fillShopNames(); route();
    })
    .catch((err) => {
      $("#cards").removeAttribute("aria-busy");
      $("#cards").innerHTML = `<li class="empty"><b>お店の情報を読み込めませんでした</b><p>通信の状態を確かめて、もう一度お試しください。${/^エラー \d+$/.test(err.message) ? `<br><small>（${esc(err.message)}）</small>` : ""}</p>
        <div class="empty-acts"><button type="button" class="go" onclick="location.reload()">もう一度読み込む</button></div></li>`;
    });
})();
