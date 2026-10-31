-- 代表 10/31「不明なものは、私が確認します」：代表が確かめた結果を lunch_manual に入れる（Google の印より優先）
-- 公開ビューの lunch_google は「代表の確認 → Google」の順に決めた値にする（サイトの側は変えずにすむ）
alter table public.shops add column if not exists lunch_manual boolean;

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
       coalesce((
         select json_agg(json_build_object('path',p.path,'caption',p.caption) order by p.sort)
         from (select p.path, p.caption, p.sort from shop_photos p
               where p.shop_id = s.id and not p.is_hidden
               order by p.sort limit case when public.is_paid(s.id) then 5 else 1 end) p), '[]') as photos,
       s.updated_at,
       case when public.is_paid(s.id) or s.field_sources ? 'tel' then s.tel else '' end as tel,
       s.kana, s.opened_on, s.instagram_shared,
       case when public.is_paid(s.id) then s.address else '' end as address,
       case when public.is_paid(s.id) then s.seats else '' end as seats,
       case when public.is_paid(s.id) then s.course else '' end as course,
       case when public.is_paid(s.id) then s.lunch else '' end as lunch,
       case when public.is_paid(s.id) then s.budget_lunch else '' end as budget_lunch,
       case when public.is_paid(s.id) then s.budget_dinner else '' end as budget_dinner,
       case when public.is_paid(s.id) then s.private_room else '' end as private_room,
       case when public.is_paid(s.id) then s.reservation else '' end as reservation,
       case when public.is_paid(s.id) then s.reservation_url else '' end as reservation_url,
       case when public.is_paid(s.id) then s.access else '' end as access,
       case when public.is_paid(s.id) then s.status else '' end as status,
       case when public.is_paid(s.id) then s.smoking else '' end as smoking,
       case when public.is_paid(s.id) then s.payment else '' end as payment,
       case when public.is_paid(s.id) then s.solo_ok else '' end as solo_ok,
       case when public.is_paid(s.id) then s.kids_ok else '' end as kids_ok,
       case when public.is_paid(s.id) then s.takeout else '' end as takeout,
       case when public.is_paid(s.id) then s.last_order else '' end as last_order,
       case when public.is_paid(s.id) then s.website else '' end as website,
       coalesce(s.lunch_manual, s.lunch_google) as lunch_google, s.lunch_checked
from public.shops s
where not s.is_hidden;
grant select on public.public_shops to anon, authenticated;
