-- Google の店と同じか確かめきれないお店を、管理画面で分けて見られるようにする
-- 代表の指示（2026-10-08）「254件は管理画面で分けて表示させてください。住所と電話番号で確かめ直してOkです。」
-- google_check：null＝確認不要／'要確認'＝Google の候補が別の店かもしれない
-- google_candidate_id：Google の候補の place_id（保存してよいのは place_id だけ）。同じ店と確かめたら google_place_id に移す
alter table public.shops add column if not exists google_check text;
alter table public.shops add column if not exists google_candidate_id text;

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
    new.google_place_id := old.google_place_id; new.google_check := old.google_check; new.google_candidate_id := old.google_candidate_id;
    if new.instagram is distinct from old.instagram then new.instagram_from := 'owner'; end if;
    new.catch := left(new.catch, 40); new.description := left(new.description, 400);
    new.tel := left(regexp_replace(new.tel, '[^0-9+-]', '', 'g'), 20);
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.guard_shop_update() from public, anon, authenticated;
