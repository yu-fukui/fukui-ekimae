-- 表の権限を、自動の既定に頼らず明記する（Supabase 2026-10-30 から、public に新しく作る表には
-- Data API の権限が自動では付かなくなる。作り直し＝新プロジェクト・preview branch・db reset も対象）。
-- 権限は RLS の決まりに合わせて必要な分だけ。anon は公開ビューを読むのと、問い合わせを送るのだけ。
-- 本番の今の権限（既定で全部付いている）を狭めるものではないが、作り直したときはこの内容になる。
-- 決まり：これから表を作るマイグレーションでは、同じファイルに GRANT を書く（README「表を作るとき」）。

-- 公開の一覧（ビュー）
grant select on public.public_shops to anon, authenticated;

-- お店まわり：ログインしたオーナー・運営だけ（どこまで触れるかは RLS が決める）
grant select, insert, update, delete on public.shops, public.shop_links, public.shop_photos,
  public.shop_members, public.update_requests to authenticated;

-- 問い合わせ：だれでも送れる（読む・直すのは運営だけ。RLS）
grant insert on public.inquiries to anon;
grant select, insert, update, delete on public.inquiries to authenticated;

-- 契約・運営者の一覧：読むだけ（書くのは Stripe の通知＝service_role）
grant select on public.subscriptions, public.admins to authenticated;

-- service_role（Edge Functions・Actions）はすべて
grant all on public.shops, public.shop_links, public.shop_photos, public.shop_members, public.update_requests,
  public.inquiries, public.subscriptions, public.admins, public.places_usage, public.public_shops to service_role;
