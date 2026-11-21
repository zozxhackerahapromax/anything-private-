-- Run this file once in Supabase SQL Editor.
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'customer' check (role in ('customer', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references auth.users(id) on delete cascade,
  cake_name text not null check (char_length(cake_name) between 1 and 100),
  cake_size text not null check (char_length(cake_size) between 1 and 100),
  needed_by date,
  description text not null check (char_length(description) between 1 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'payment_submitted', 'confirmed', 'declined')),
  payment_path text,
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index if not exists orders_customer_created_idx on public.orders(customer_id, created_at desc);
create index if not exists messages_order_created_idx on public.messages(order_id, created_at);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'admin');
$$;
revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup
after insert on auth.users
for each row execute procedure public.create_profile_for_new_user();

alter table public.profiles enable row level security;
alter table public.orders enable row level security;
alter table public.messages enable row level security;

grant select on public.profiles to authenticated;
grant select, insert, update on public.orders to authenticated;
grant select, insert on public.messages to authenticated;

drop policy if exists "Users can view their own profile and admins can view profiles" on public.profiles;
create policy "Users can view their own profile and admins can view profiles"
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select public.is_admin()));

-- There are deliberately no client insert/update/delete policies for profiles.
-- Promote a trusted admin out-of-band in SQL; customer roles cannot self-assign.
drop policy if exists "Customers create own orders" on public.orders;
create policy "Customers create own orders"
on public.orders for insert to authenticated
with check (customer_id = (select auth.uid()) and status = 'pending' and payment_path is null);

drop policy if exists "Customers and admins view orders" on public.orders;
create policy "Customers and admins view orders"
on public.orders for select to authenticated
using (customer_id = (select auth.uid()) or (select public.is_admin()));

drop policy if exists "Admins update orders" on public.orders;
create policy "Admins update orders"
on public.orders for update to authenticated
using ((select public.is_admin()))
with check ((select public.is_admin()));

drop policy if exists "Customer submits own receipt" on public.orders;
create policy "Customer submits own receipt"
on public.orders for update to authenticated
using (customer_id = (select auth.uid()) and status = 'approved' and payment_path is null)
with check (customer_id = (select auth.uid()) and status = 'payment_submitted' and payment_path is not null);

-- Customers and admins can read messages for orders they are allowed to see.
drop policy if exists "Order participants read messages" on public.messages;
create policy "Order participants read messages"
on public.messages for select to authenticated
using (
  exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or (select public.is_admin())))
);

drop policy if exists "Order participants send messages as themselves" on public.messages;
create policy "Order participants send messages as themselves"
on public.messages for insert to authenticated
with check (
  sender_id = (select auth.uid()) and
  exists (select 1 from public.orders o where o.id = order_id and (o.customer_id = (select auth.uid()) or (select public.is_admin())))
);

-- Private payment proof images. The first object-name segment is the customer ID.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 8388608, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public = false, file_size_limit = 8388608, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Customers upload receipts to their own folder" on storage.objects;
create policy "Customers upload receipts to their own folder"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text
  and exists (
    select 1 from public.orders o
    where o.id::text = (storage.foldername(name))[2]
      and o.customer_id = (select auth.uid()) and o.status = 'approved' and o.payment_path is null
  )
);

drop policy if exists "Customers and admins read payment receipts" on storage.objects;
create policy "Customers and admins read payment receipts"
on storage.objects for select to authenticated
using (
  bucket_id = 'payment-proofs' and (
    (storage.foldername(name))[1] = (select auth.uid())::text or (select public.is_admin())
  )
);

drop policy if exists "Customers delete their own receipt if needed" on storage.objects;
create policy "Customers delete their own receipt if needed"
on storage.objects for delete to authenticated
using (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Enable realtime for chat updates (safe to run if already included).
do $$
begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null;
end;
$$;
