-- Google の口コミの星を全店に出す（代表の指示 2026-10-08「Googleのデータの表示方法はこれでOKです。全体に反映して」）
-- Google の決まりで保存してよいのは place_id だけ。星と件数は表示のたびに Edge Function（google-place）が取る。
-- public_shops には出さない（Edge Function が service_role で読む）。オーナーは書き換えられない。
alter table public.shops add column if not exists google_place_id text;

create or replace function public.guard_shop_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  -- SQL エディタや service_role（Webhook など）からの変更は対象外。ログインしたオーナーだけを縛る。
  if auth.role() = 'authenticated' and not is_admin() then
    new.slug := old.slug; new.name := old.name; new.zone := old.zone; new.town := old.town;
    new.category := old.category; new.address := old.address;
    new.sources := old.sources; new.admin_note := old.admin_note;
    new.kana := old.kana; new.opened_on := old.opened_on; new.instagram_shared := old.instagram_shared;
    new.field_sources := old.field_sources; new.verified_at := old.verified_at; new.status := old.status;
    new.plan := old.plan; new.plan_until := old.plan_until; new.is_hidden := old.is_hidden;
    new.google_place_id := old.google_place_id;
    if new.instagram is distinct from old.instagram then new.instagram_from := 'owner'; end if;
    new.catch := left(new.catch, 40); new.description := left(new.description, 400);
    new.tel := left(regexp_replace(new.tel, '[^0-9+-]', '', 'g'), 20);
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.guard_shop_update() from public, anon, authenticated;
