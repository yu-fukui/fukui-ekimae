// 初期データの投入は終わりました。この関数は使いません（管理画面から削除してよい）。
Deno.serve(() => new Response("gone", { status: 410 }));
