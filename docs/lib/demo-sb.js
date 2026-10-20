// 見本モード（?demo=login / free / owner / admin）用の、Supabase の代わり。
// 画面のデザインを確かめるためだけのもので、データはこのページの中だけで動き、どこにも保存されない。
const now = Date.now(), day = 86400000, iso = (t) => new Date(t).toISOString();
const SHOP_PAID = "d0000000-0000-0000-0000-000000000001", SHOP_FREE = "d0000000-0000-0000-0000-000000000002";
const USER = "u0000000-0000-0000-0000-000000000001";

function seed(role) {
  const paid = role !== "free";
  return {
    shops: [
      { id: SHOP_PAID, slug: "demo-bar", name: "BAR ほしあかり（見本）", zone: "katamachi", town: "順化", category: "night", genre: "バー",
        instagram: "hoshiakari_bar", instagram_from: "owner", catch: "一枚板のカウンターで、フルーツカクテルを",
        description: "片町の路地裏にあるオーセンティックバーです。福井の旬のフルーツを使ったカクテルと、ウイスキー200種をご用意。一軒目にも、締めの一杯にもどうぞ。",
        hours: "20:00〜翌3:00", holiday: "日曜", address: "福井市順化1-0-0", tel: "0776-00-0000", admin_note: "", sources: [],
        plan: paid ? "monthly" : "free", plan_until: paid ? iso(now + 21 * day) : null, is_hidden: false, updated_at: iso(now - 2 * day) },
      { id: SHOP_FREE, slug: "demo-soba", name: "そば処 ふくふく庵（見本）", zone: "ekimae", town: "中央", category: "gourmet", genre: "そば・うどん",
        instagram: "", instagram_from: "research", catch: "", description: "", hours: "", holiday: "", address: "福井市中央1-0-0", tel: "0776-00-0001",
        admin_note: "", sources: ["URALA", "福いろ"], plan: "free", plan_until: null, is_hidden: false, updated_at: iso(now - 9 * day) },
      ...["寿し 吉田", "Agit(アジト)", "喫茶 ことり（見本）", "スナック ゆうなぎ（見本）", "BAR 月下", "おでん 石田屋"].map((name, i) => ({
        id: `d000000${i}-1111-0000-0000-000000000000`, slug: `x${i}`, name, zone: i % 2 ? "katamachi" : "ekimae", town: i % 2 ? "順化" : "中央",
        category: i % 3 === 1 ? "night" : "gourmet", genre: "その他", instagram: "", plan: i === 2 ? "yearly" : "free", plan_until: i === 2 ? iso(now + 200 * day) : null,
        is_hidden: i === 5, address: "", tel: "", admin_note: "", updated_at: iso(now - i * day) })),
    ],
    shop_members: [{ shop_id: role === "free" ? SHOP_FREE : SHOP_PAID, user_id: USER, email: "owner@example.com", invited_at: iso(now - 30 * day) }],
    shop_links: paid ? [
      { id: "l1", shop_id: SHOP_PAID, kind: "x", label: "", url: "https://example.com/x", sort: 0 },
      { id: "l2", shop_id: SHOP_PAID, kind: "line", label: "LINE で予約", url: "https://example.com/line", sort: 1 },
    ] : [],
    shop_photos: paid ? [
      { id: "p1", shop_id: SHOP_PAID, path: "../demo/bar-1.jpg", caption: "季節のフルーツカクテル", sort: 0, is_hidden: false, created_at: iso(now - day) },
      { id: "p2", shop_id: SHOP_PAID, path: "../demo/bar-3.jpg", caption: "ボトルの並ぶバックバー", sort: 1, is_hidden: false, created_at: iso(now - 2 * day) },
      { id: "p3", shop_id: SHOP_PAID, path: "../demo/bar-2.jpg", caption: "", sort: 2, is_hidden: false, created_at: iso(now - 3 * day) },
      ...(role === "admin" ? [
        { id: "p4", shop_id: "d0000002-1111-0000-0000-000000000000", path: "../demo/cafe-1.jpg", caption: "季節のタルト", sort: 0, is_hidden: false, created_at: iso(now - 2 * 3600000) },
        { id: "p5", shop_id: "d0000002-1111-0000-0000-000000000000", path: "../demo/cafe-2.jpg", caption: "", sort: 1, is_hidden: false, created_at: iso(now - 5 * day) },
      ] : []),
    ] : [],
    update_requests: [
      { id: "r1", shop_id: SHOP_FREE, user_id: USER, body: "Instagram のアカウントを作りました。@fukufukuan_soba です。", status: "open", admin_note: "", created_at: iso(now - 3600000) },
      { id: "r2", shop_id: SHOP_FREE, user_id: USER, body: "ジャンルを「そば」にしてほしいです。", status: "done", admin_note: "直しました。ありがとうございます。", created_at: iso(now - 5 * day) },
    ],
    inquiries: [
      { id: "q1", shop_name: "居酒屋 まるまる", contact: "info@example.com", message: "掲載をお願いしたいです。写真も載せたいので有料プランの説明を聞きたいです。", status: "open", created_at: iso(now - 7200000) },
      { id: "q2", shop_name: "カフェ さんかく", contact: "0776-00-1234", message: "閉店したので掲載をやめてください。", status: "done", created_at: iso(now - 4 * day) },
    ],
    subscriptions: paid ? [{ shop_id: SHOP_PAID, stripe_customer_id: "cus_demo", stripe_subscription_id: "sub_demo", status: "active", interval: "month", current_period_end: iso(now + 18 * day) }] : [],
  };
}

export const demoUrls = new Map();

export function createDemoClient(role) {
  const db = seed(role);
  const session = role === "login" ? null : { user: { id: USER, email: role === "admin" ? "admin@example.com" : "owner@example.com" } };
  const embed = (table, row, sel) => {
    const out = { ...row };
    if (/shops\(/.test(sel)) out.shops = db.shops.find((s) => s.id === row.shop_id) || null;
    if (/shop_members\(/.test(sel)) out.shop_members = db.shop_members.filter((m) => m.shop_id === row.id);
    return out;
  };
  class Q {
    constructor(t) { this.t = t; this.filters = []; this.op = "select"; this.sel = "*"; }
    select(sel = "*", o = {}) { if (this.op === "select") this.sel = sel; this.head = o.head; this.wantRows = true; return this; }
    eq(c, v) { this.filters.push((r) => r[c] === v); return this; }
    neq(c, v) { this.filters.push((r) => r[c] !== v); return this; }
    or(expr) {
      const parts = expr.split(",").map((x) => x.match(/^(\w+)\.ilike\.\*(.*)\*$/)).filter(Boolean);
      this.filters.push((r) => parts.some(([, c, v]) => String(r[c] || "").toLowerCase().includes(v.toLowerCase())));
      return this;
    }
    is(c, v) { this.filters.push((r) => (r[c] ?? null) === v); return this; }
    not(c, op, v) { this.filters.push((r) => (r[c] ?? null) !== v); return this; }
    in(c, a) { this.filters.push((r) => a.includes(r[c])); return this; }
    ilike(c, p) { const re = new RegExp(p.replace(/%/g, ".*"), "i"); this.filters.push((r) => re.test(r[c] || "")); return this; }
    order(c, o = {}) { this.sortBy = [c, o.ascending !== false]; return this; }
    limit(n) { this.lim = n; return this; }
    maybeSingle() { this.one = "maybe"; return this; }
    single() { this.one = "single"; return this; }
    insert(row) { this.op = "insert"; this.row = row; return this; }
    update(row) { this.op = "update"; this.row = row; return this; }
    upsert(row) { this.op = "insert"; this.row = row; return this; }
    delete() { this.op = "delete"; return this; }
    run() {
      const rows = db[this.t] || (db[this.t] = []);
      const hit = (r) => this.filters.every((f) => f(r));
      if (this.op === "insert") {
        const r = { id: Math.random().toString(36).slice(2), created_at: new Date().toISOString(), status: "open", is_hidden: false, ...this.row };
        if (this.t === "shop_photos" && rows.filter((x) => x.shop_id === r.shop_id).length >= 5) return { data: null, error: { message: "上限（5件）に達しています" } };
        if (this.t === "shop_links" && rows.filter((x) => x.shop_id === r.shop_id).length >= 10) return { data: null, error: { message: "上限（10件）に達しています" } };
        rows.push(r); return { data: this.one ? r : [r], error: null };
      }
      if (this.op === "update") { rows.filter(hit).forEach((r) => Object.assign(r, this.row)); return { data: null, error: null }; }
      if (this.op === "delete") { db[this.t] = rows.filter((r) => !hit(r)); return { data: null, error: null }; }
      let out = rows.filter(hit).map((r) => embed(this.t, r, this.sel));
      if (this.sortBy) { const [c, asc] = this.sortBy; out.sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (this.lim) out = out.slice(0, this.lim);
      if (this.head) return { count: out.length, data: null, error: null };
      if (this.one) return { data: out[0] || null, error: out[0] || this.one === "maybe" ? null : { message: "not found" } };
      return { data: out, error: null };
    }
    then(res, rej) { return Promise.resolve(this.run()).then(res, rej); }
  }
  return {
    from: (t) => new Q(t),
    rpc: async (fn) => ({ data: fn === "is_admin" ? role === "admin" : null, error: null }),
    auth: {
      onAuthStateChange(cb) { setTimeout(() => cb(session ? "SIGNED_IN" : "SIGNED_OUT", session), 0); return { data: { subscription: { unsubscribe() {} } } }; },
      signInWithOtp: async () => ({ error: null }),
      signInWithPassword: async () => ({ error: { message: "見本のため、ログインはできません" } }),
      updateUser: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
    },
    storage: { from: () => ({
      upload: async (path, blob) => { demoUrls.set(path, URL.createObjectURL(blob)); return { error: null }; },
      remove: async () => ({ error: null }),
    }) },
    functions: { invoke: async () => ({ data: null, error: { message: "見本のため、決済画面は開きません（準備中）", context: { json: async () => ({}) } } }) },
  };
}
