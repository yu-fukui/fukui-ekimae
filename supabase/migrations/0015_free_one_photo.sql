-- 無料の店舗会員も写真を1枚だけ載せられるようにする（代表の指示 2026-10-06）
-- 有料は今までどおり5枚。有料から無料に戻ったときは写真を消さず、公開は1枚目だけ。

-- 枚数の上限：写真は有料5枚・無料1枚（運営は5枚まで）。リンクは10件のまま
create or replace function public.limit_children() returns trigger
language plpgsql as $$
declare n int; lim int;
begin
  lim := case
    when tg_table_name <> 'shop_photos' then 10
    when public.is_paid(new.shop_id) or public.is_admin() or auth.role() is distinct from 'authenticated' then 5
    else 1 end;
  execute format('select count(*) from public.%I where shop_id = $1', tg_table_name) into n using new.shop_id;
  if n >= lim then raise exception '上限（%件）に達しています', lim; end if;
  return new;
end $$;

-- オーナーは無料でも自分の店の写真を扱える（枚数は上のトリガーで止める）
drop policy if exists photos_member on public.shop_photos;
create policy photos_member on public.shop_photos for all using (is_member(shop_id)) with check (is_member(shop_id));

-- 画像ファイル：無料のお店は同時に置けるのは2つまで（差し替えのため1つ余分に）
drop policy if exists photos_obj_write on storage.objects;
create policy photos_obj_write on storage.objects for insert to authenticated with check (
  bucket_id = 'photos' and (is_admin() or (
    is_member(((storage.foldername(name))[1])::uuid) and (
      is_paid(((storage.foldername(name))[1])::uuid)
      or (select count(*) from storage.objects o
          where o.bucket_id = 'photos' and (storage.foldername(o.name))[1] = (storage.foldername(name))[1]) < 2))));

-- 公開ビュー：写真は有料5枚・無料1枚
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
       case when public.is_paid(s.id) then s.website else '' end as website
from public.shops s
where not s.is_hidden;
grant select on public.public_shops to anon, authenticated;
