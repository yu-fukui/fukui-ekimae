-- 解約の予定日を持つ（お店の管理画面に「解約済み・○月○日で終了」と出すため）
alter table public.subscriptions add column if not exists cancel_at timestamptz;
