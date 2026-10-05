-- 権限（RLS）の確認。stub_supabase.sql と migrations を流したあとに実行する。
-- 期待どおりでなければ例外で止まる。
\set ON_ERROR_STOP 1
insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a','yasu29fr@gmail.com'),
  ('00000000-0000-0000-0000-0000000000f1','free@example.com'),
  ('00000000-0000-0000-0000-0000000000b1','paid@example.com'),
  ('00000000-0000-0000-0000-0000000000c1','other@example.com');
insert into shops (id,slug,name,zone,town,category,genre,instagram,address,tel,plan,plan_until) values
  ('10000000-0000-0000-0000-000000000001','free-shop','無料の店','ekimae','中央','gourmet','和食','free_ig','福井市中央1-1-1','0776000001','free',null),
  ('10000000-0000-0000-0000-000000000002','paid-shop','有料の店','katamachi','順化','night','バー','paid_ig','福井市順化1-1-1','0776000002','monthly', now() + interval '20 days'),
  ('10000000-0000-0000-0000-000000000003','expired','期限切れの店','ekimae','大手','gourmet','洋食','','','','monthly', now() - interval '1 day'),
  ('10000000-0000-0000-0000-000000000004','hidden','非表示の店','ekimae','大手','gourmet','洋食','','','','free', null);
update shops set is_hidden = true where slug = 'hidden';
insert into shop_members (shop_id,user_id,email) values
  ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1','free@example.com'),
  ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000b1','paid@example.com'),
  ('10000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-0000000000c1','other@example.com');

create function pg_temp.as_user(uid text, email text) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub',uid,'email',email,'role','authenticated')::text, false) $$;
create function pg_temp.check(ok boolean, label text) returns void language plpgsql as $$
  begin if not ok then raise exception 'NG: %', label; end if; raise notice 'OK: %', label; end $$;

-- 1. 未ログイン：公開ビューは読める。shops 本体は読めない。非表示の店は出ない。無料の店の紹介文は空。
set role anon; select set_config('request.jwt.claims','',false);
select pg_temp.check((select count(*) from public_shops) = 3, '未ログインは公開ビューで3店（非表示を除く）');
select pg_temp.check((select count(*) from shops) = 0, '未ログインは shops 本体を読めない');
select pg_temp.check((select is_paid from public_shops where slug='paid-shop'), '有料の店は is_paid');
select pg_temp.check(not (select is_paid from public_shops where slug='expired'), '期限切れは無料扱い');
insert into inquiries (shop_name, contact, message) values ('テスト店','test@example.com','掲載したい');
select pg_temp.check(true, '未ログインでも掲載問い合わせを送れる');
insert into inquiries (kind, shop_id, shop_name, contact) values ('owner', (select id from public_shops where slug='free-shop'), '無料の店', 'owner@example.com');
select pg_temp.check(true, '未ログインでも店舗会員の申し込み（店つき）を送れる');
reset role;

-- 2. 無料のオーナー：自分の店は読める。編集はできない（0行）。更新依頼は送れる。
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000f1','free@example.com');
select pg_temp.check((select count(*) from shops) = 1, '無料オーナーは自分の店だけ読める');
with u as (update shops set description='書き換え' where slug='free-shop' returning 1)
select pg_temp.check((select count(*) from u) = 0, '無料オーナーは店を編集できない');
insert into update_requests (shop_id,user_id,body) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000f1','営業時間が変わりました');
select pg_temp.check(true, '無料オーナーは更新依頼を送れる');
do $$ begin
  insert into update_requests (shop_id,user_id,body) values ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-0000000000f1','他店へのいたずら');
  raise exception 'NG: 他店への更新依頼が通ってしまった';
exception when insufficient_privilege then raise notice 'OK: 他店には更新依頼を送れない'; end $$;
do $$ begin
  insert into shop_links (shop_id,url) values ('10000000-0000-0000-0000-000000000001','https://example.com');
  raise exception 'NG: 無料なのにリンクを追加できた';
exception when insufficient_privilege then raise notice 'OK: 無料オーナーはリンクを追加できない'; end $$;
reset role;

-- 3. 有料のオーナー：紹介文は編集できる。店名やプランは変えられない（元に戻る）。リンク・写真は上限まで。
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1','paid@example.com');
update shops set description='落ち着いたバーです', name='乗っ取り', plan='yearly', is_hidden=true, instagram='new_ig' where slug='paid-shop';
reset role;
select pg_temp.check((select description from shops where slug='paid-shop') = '落ち着いたバーです', '有料オーナーは紹介文を編集できる');
select pg_temp.check((select name from shops where slug='paid-shop') = '有料の店', '店名は運営以外は変えられない');
select pg_temp.check((select plan from shops where slug='paid-shop') = 'monthly', 'プランは運営以外は変えられない');
select pg_temp.check(not (select is_hidden from shops where slug='paid-shop'), '非表示フラグは運営以外は変えられない');
select pg_temp.check((select instagram_from from shops where slug='paid-shop') = 'owner', 'オーナーが変えた Instagram は owner 扱い');
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1','paid@example.com');
insert into shop_photos (shop_id,path,sort) select '10000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002/'||g||'.webp', g from generate_series(1,5) g;
select pg_temp.check(true, '有料オーナーは写真を5枚まで追加できる');
do $$ begin
  insert into shop_photos (shop_id,path) values ('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000002/6.webp');
  raise exception 'NG: 6枚目が入ってしまった';
exception when raise_exception then
  if sqlerrm like 'NG:%' then raise; end if; raise notice 'OK: 写真は6枚目で止まる'; end $$;
insert into storage.objects (bucket_id,name) values ('photos','10000000-0000-0000-0000-000000000002/a.webp');
select pg_temp.check(true, '有料オーナーは自分の店のフォルダに画像を置ける');
do $$ begin
  insert into storage.objects (bucket_id,name) values ('photos','10000000-0000-0000-0000-000000000001/x.webp');
  raise exception 'NG: 他店のフォルダに置けてしまった';
exception when insufficient_privilege then raise notice 'OK: 他店のフォルダには置けない'; end $$;
reset role;

-- 4. 期限切れのオーナー：編集できない
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000c1','other@example.com');
with u as (update shops set description='x' where slug='expired' returning 1)
select pg_temp.check((select count(*) from u) = 0, '期限切れのオーナーは編集できない');
select pg_temp.check((select count(*) from update_requests) = 0, '他人の更新依頼は見えない');
reset role;

-- 5. 運営：全部読めて、店名やプランも変えられる
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','yasu29fr@gmail.com');
select pg_temp.check((select count(*) from shops) = 4, '運営は全店（非表示含む）を読める');
update shops set name='有料の店（改）', plan='yearly' where slug='paid-shop';
select pg_temp.check((select name from shops where slug='paid-shop') = '有料の店（改）', '運営は店名を変えられる');
select pg_temp.check((select count(*) from inquiries) = 2, '運営は問い合わせを読める');
select pg_temp.check((select shop_id from inquiries where kind='owner') = (select id from shops where slug='free-shop'), '申し込みに店がつく');
reset role;

-- 6. 公開ビュー：有料の店は写真5枚・紹介文が出る
set role anon; select set_config('request.jwt.claims','',false);
select pg_temp.check((select json_array_length(photos) from public_shops where slug='paid-shop') = 5, '公開ビューに写真5枚');
select pg_temp.check((select description from public_shops where slug='free-shop') = '', '無料の店の紹介文は公開されない');
reset role;

-- 電話番号（0005_paid_tel.sql）：公開ビューでは有料の店だけ見える。有料オーナーは編集できる
set role anon; select set_config('request.jwt.claims','',false);
select pg_temp.check((select tel from public_shops where slug='paid-shop') = '0776000002', '有料の店は公開ビューに電話番号が出る');
select pg_temp.check((select tel from public_shops where slug='free-shop') = '', '無料の店は電話番号が出ない');
reset role;
set role authenticated; select pg_temp.as_user('00000000-0000-0000-0000-0000000000b1','paid@example.com');
update shops set tel = '0776-11-2222（代表）' where slug='paid-shop';
reset role;
select pg_temp.check((select tel from shops where slug='paid-shop') = '0776-11-2222', '有料オーナーは電話番号を編集できる（数字と記号だけ残る）');
\echo ALL_RLS_TESTS_PASSED
