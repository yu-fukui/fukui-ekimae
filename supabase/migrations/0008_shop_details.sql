-- お店の項目を増やす（代表の指示 2026-10-04）
-- ・席数・コース・予算・個室・予約・アクセス・営業の状態・喫煙・支払い・一人・子連れ・テイクアウト・ラストオーダー
--   空欄はサイトに出さない。公開ビューには全店ぶん出す
-- ・field_sources：項目ごとの出どころと確認日（運営だけが見る）。例 {"tel": {"src": "hotpepper", "url": "...", "checked": "2026-10-05"}}
--   無料のお店の電話・定休日・住所は、出どころを確かめた項目（field_sources にキーがある）だけ公開する
-- ・verified_at：最後に営業を確かめた日（運営だけが見る）
alter table public.shops add column if not exists seats text not null default '';
alter table public.shops add column if not exists course text not null default '';
alter table public.shops add column if not exists lunch text not null default '';
alter table public.shops add column if not exists budget_lunch text not null default '';
alter table public.shops add column if not exists budget_dinner text not null default '';
alter table public.shops add column if not exists private_room text not null default '';
alter table public.shops add column if not exists reservation text not null default '';
alter table public.shops add column if not exists reservation_url text not null default '';
alter table public.shops add column if not exists access text not null default '';
alter table public.shops add column if not exists status text not null default '';
alter table public.shops add column if not exists smoking text not null default '';
alter table public.shops add column if not exists payment text not null default '';
alter table public.shops add column if not exists solo_ok text not null default '';
alter table public.shops add column if not exists kids_ok text not null default '';
alter table public.shops add column if not exists takeout text not null default '';
alter table public.shops add column if not exists last_order text not null default '';
alter table public.shops add column if not exists field_sources jsonb not null default '{}'::jsonb;
alter table public.shops add column if not exists verified_at date;

create or replace view public.public_shops as
select s.id, s.slug, s.name, s.zone, s.town, s.category, s.genre, s.instagram,
       public.is_paid(s.id) as is_paid,
       case when public.is_paid(s.id) then s.catch       else '' end as catch,
       case when public.is_paid(s.id) then s.description else '' end as description,
       case when public.is_paid(s.id) then s.hours       else '' end as hours,
       case when public.is_paid(s.id) or s.field_sources ? 'holiday' then s.holiday else '' end as holiday,
       case when public.is_paid(s.id) then coalesce((
         select json_agg(json_build_object('kind',l.kind,'label',l.label,'url',l.url) order by l.sort)
         from shop_links l where l.shop_id = s.id), '[]') else '[]' end as links,
       case when public.is_paid(s.id) then coalesce((
         select json_agg(json_build_object('path',p.path,'caption',p.caption) order by p.sort)
         from shop_photos p where p.shop_id = s.id and not p.is_hidden), '[]') else '[]' end as photos,
       s.updated_at,
       case when public.is_paid(s.id) or s.field_sources ? 'tel' then s.tel else '' end as tel,
       s.kana, s.opened_on, s.instagram_shared,
       case when public.is_paid(s.id) or s.field_sources ? 'address' then s.address else '' end as address,
       s.seats, s.course, s.lunch, s.budget_lunch, s.budget_dinner, s.private_room,
       s.reservation, s.reservation_url, s.access, s.status,
       s.smoking, s.payment, s.solo_ok, s.kids_ok, s.takeout, s.last_order
from public.shops s
where not s.is_hidden;
grant select on public.public_shops to anon, authenticated;

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
    if new.instagram is distinct from old.instagram then new.instagram_from := 'owner'; end if;
    new.catch := left(new.catch, 40); new.description := left(new.description, 400);
    new.tel := left(regexp_replace(new.tel, '[^0-9+-]', '', 'g'), 20);
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.guard_shop_update() from public, anon, authenticated;
