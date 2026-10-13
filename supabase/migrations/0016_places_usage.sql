-- Google Places API を呼んだ回数を数える（代表 10/13「1週間の数字を報告して」）。
-- google-place（お店のページの星）が Google に問い合わせるたびに、その日の回数に1足す。
-- 数えるだけ。上限はつけない（代表がまだ決めていない）。読むのは運用部の集計と管理者だけ。
create table if not exists public.places_usage (
  day date not null,
  source text not null,            -- 'google-place'（お店のページの星）など、どこから呼んだか
  calls integer not null default 0,
  primary key (day, source)
);
alter table public.places_usage enable row level security;
-- 公開側からは読めない・書けない（service_role だけ）

create or replace function public.count_places_call(p_source text)
returns void language sql security definer set search_path = public as $$
  insert into public.places_usage (day, source, calls)
  values ((now() at time zone 'Asia/Tokyo')::date, p_source, 1)
  on conflict (day, source) do update set calls = places_usage.calls + 1;
$$;
revoke all on function public.count_places_call(text) from public, anon, authenticated;
grant execute on function public.count_places_call(text) to service_role;
