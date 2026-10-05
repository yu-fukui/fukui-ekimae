-- お店の公式ホームページ（代表の指示 2026-10-05）
-- 無料のお店も含め、公式サイトがあればリンクを出す
alter table public.shops add column if not exists website text not null default '';

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
       s.smoking, s.payment, s.solo_ok, s.kids_ok, s.takeout, s.last_order,
       s.website
from public.shops s
where not s.is_hidden;
grant select on public.public_shops to anon, authenticated;
