-- お問い合わせに「ご用件」と「どの店か」を持たせる（店舗会員の申し込みを、管理画面からそのまま招待できるように）
alter table public.inquiries
  add column if not exists kind text not null default 'other'
    check (kind in ('owner','fix','remove','closed','other')),
  add column if not exists shop_id uuid references public.shops on delete set null;
create index if not exists inquiries_shop_idx on public.inquiries (shop_id);
