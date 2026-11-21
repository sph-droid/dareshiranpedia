-- 誰もしらんペディア: テーブル作成SQL (Supabase SQL Editor で実行)
-- 冪等ではないため、実行は1回だけ。エラーが出たら途中で止めて報告してください。

create table if not exists public.articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  category text not null default '未分類',
  tags text[] not null default '{}',
  related text[] not null default '{}',
  status text not null default 'public' check (status in ('public', 'hidden')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.article_images (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  storage_path text not null,
  caption text not null default '',
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.revisions (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references public.articles(id) on delete cascade,
  title text not null,
  body text not null default '',
  category text not null default '未分類',
  tags text[] not null default '{}',
  related text[] not null default '{}',
  nickname text not null default '匿名',
  kind text not null default 'edit' check (kind in ('create', 'edit', 'restore')),
  ip_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  article_id uuid references public.articles(id) on delete set null,
  reason text not null default '',
  detail text not null default '',
  status text not null default 'open' check (status in ('open', 'done')),
  ip_hash text,
  created_at timestamptz not null default now()
);

create table if not exists public.rate_limits (
  ip_hash text not null,
  action text not null,
  day date not null,
  count int not null default 0,
  last_at timestamptz,
  primary key (ip_hash, action, day)
);

create table if not exists public.bans (
  ip_hash text primary key,
  until timestamptz,
  reason text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.admin_actions (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  target text not null default '',
  detail text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists idx_articles_updated on public.articles (updated_at desc);
create index if not exists idx_articles_status on public.articles (status);
create index if not exists idx_images_article on public.article_images (article_id, sort);
create index if not exists idx_revisions_article on public.revisions (article_id, created_at desc);
create index if not exists idx_reports_status on public.reports (status, created_at desc);

-- RLS: 全テーブルで有効化。公開読み取りは「公開中の記事とその画像」のみ。
-- 書き込みはサーバー側API（サービスロールキー）だけが行う前提。
alter table public.articles enable row level security;
alter table public.article_images enable row level security;
alter table public.revisions enable row level security;
alter table public.reports enable row level security;
alter table public.rate_limits enable row level security;
alter table public.bans enable row level security;
alter table public.admin_actions enable row level security;

drop policy if exists "public read articles" on public.articles;
create policy "public read articles" on public.articles
  for select using (status = 'public');

drop policy if exists "public read images" on public.article_images;
create policy "public read images" on public.article_images
  for select using (
    exists (select 1 from public.articles a where a.id = article_id and a.status = 'public')
  );

-- 画像保存用バケット（公開読み取り、アップロードはサーバー経由のみ）
insert into storage.buckets (id, name, public)
values ('article-images', 'article-images', true)
on conflict (id) do nothing;
