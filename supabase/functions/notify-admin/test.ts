// deno test --allow-env notify-admin/test.ts
// 届いた依頼の種類ごとに正しいメールができるか、合言葉がないと送らないかを確かめる。
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { handler, type Mail } from "./index.ts";

function setup() {
  const sent: Mail[] = [];
  const deps = { secret: "s3cret", send: (m: Mail) => { sent.push(m); return Promise.resolve(); }, shopName: (id: string) => Promise.resolve(id === "shop-1" ? "Bar テスト" : "?") };
  const call = (body: unknown, secret = "s3cret") =>
    handler(new Request("http://x/", { method: "POST", headers: { "x-webhook-secret": secret }, body: JSON.stringify(body) }), deps);
  return { sent, call };
}

Deno.test("お問い合わせが届いたらメールを送る", async () => {
  const { sent, call } = setup();
  const res = await call({ type: "INSERT", table: "inquiries", record: { shop_name: "スナック花", contact: "hana@example.com", message: "掲載したい" } });
  assertEquals(res.status, 200);
  assertEquals(sent.length, 1);
  assertStringIncludes(sent[0].subject, "スナック花");
  assertStringIncludes(sent[0].text, "hana@example.com");
});

Deno.test("店舗会員の申し込みは件名でわかる", async () => {
  const { sent, call } = setup();
  await call({ type: "INSERT", table: "inquiries", record: { kind: "owner", shop_name: "スナック花", contact: "hana@example.com", message: "" } });
  assertStringIncludes(sent[0].subject, "店舗会員の申し込み");
  assertStringIncludes(sent[0].text, "ご用件：店舗会員の申し込み");
});

Deno.test("更新依頼は店名を引いて送る", async () => {
  const { sent, call } = setup();
  await call({ type: "INSERT", table: "update_requests", record: { shop_id: "shop-1", body: "定休日が変わりました" } });
  assertStringIncludes(sent[0].subject, "Bar テスト");
  assertStringIncludes(sent[0].text, "定休日が変わりました");
});

Deno.test("合言葉が違えば送らない", async () => {
  const { sent, call } = setup();
  const res = await call({ type: "INSERT", table: "inquiries", record: {} }, "wrong");
  assertEquals(res.status, 401);
  assertEquals(sent.length, 0);
});

Deno.test("INSERT 以外やほかの表は送らない", async () => {
  const { sent, call } = setup();
  await call({ type: "UPDATE", table: "inquiries", record: { shop_name: "x" } });
  await call({ type: "INSERT", table: "shops", record: {} });
  assertEquals(sent.length, 0);
});
