drop function if exists public.search_visible_gear(text, int, int);

create function public.search_visible_gear(search_query text, result_limit int, result_offset int)
returns table (
  id uuid,
  user_id uuid,
  name text,
  category text,
  brand text,
  model text,
  weight integer,
  price numeric,
  year integer,
  rating integer,
  comment text,
  image_path text,
  storage_id uuid,
  visibility text,
  published_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  order_index integer,
  access_source text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    gi.id,
    gi.user_id,
    gi.name,
    gi.category,
    gi.brand,
    gi.model,
    gi.weight,
    gi.price,
    gi.year,
    gi.rating,
    gi.comment,
    gi.image_path,
    gi.storage_id,
    gi.visibility,
    gi.published_at,
    gi.created_at,
    gi.updated_at,
    gi.order_index,
    case when gi.user_id = auth.uid() then 'mine' when gi.visibility = 'public' then 'public' else 'shared_with_me' end as access_source
  from public.gear_items gi
  where public.can_read_gear_item(gi.id)
    and (
      coalesce(search_query, '') = ''
      or gi.name ilike '%' || search_query || '%'
      or gi.category ilike '%' || search_query || '%'
      or gi.brand ilike '%' || search_query || '%'
      or gi.model ilike '%' || search_query || '%'
    )
  order by gi.updated_at desc nulls last, gi.created_at desc nulls last
  limit greatest(0, least(coalesce(result_limit, 20), 100))
  offset greatest(0, coalesce(result_offset, 0));
$$;
