-- 広すぎる権限を取り消す（代表 10/22「エキマエの設定は進めて」）。
-- 本番は自動の既定で、anon・authenticated に全部の表の全部の権限（TRUNCATE なども）が付いていた。
-- RLS が守っていたので実害はなかったが、0017 に書いた必要な分だけにそろえる。
-- 公開の一覧（public_shops）は postgres の権限で動くビューなので、anon がお店の表を読めなくても止まらない。
-- おでかけの表（odekake_*）には触らない。

revoke all on public.shops, public.shop_links, public.shop_photos, public.shop_members, public.update_requests,
  public.inquiries, public.subscriptions, public.admins, public.places_usage, public.public_shops
  from anon, authenticated;

-- 0017 と同じ内容をもう一度（取り消しのあと、必要な分だけ付け直す）
grant select on public.public_shops to anon, authenticated;
grant select, insert, update, delete on public.shops, public.shop_links, public.shop_photos,
  public.shop_members, public.update_requests to authenticated;
grant insert on public.inquiries to anon;
grant select, insert, update, delete on public.inquiries to authenticated;
grant select on public.subscriptions, public.admins to authenticated;
grant all on public.shops, public.shop_links, public.shop_photos, public.shop_members, public.update_requests,
  public.inquiries, public.subscriptions, public.admins, public.places_usage, public.public_shops to service_role;
