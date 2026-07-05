-- Replace historical base64 image snapshots in shared_items with Storage object paths.
-- The actual objects were migrated from gear_items.image_path into gear-photos earlier;
-- shares only need their JSON snapshots to point at the canonical gear item image_path.

update public.shared_items si
set item_data = jsonb_set(si.item_data, '{image_path}', to_jsonb(gi.image_path), true)
from public.gear_items gi
where si.item_id = gi.id
  and gi.image_path is not null
  and gi.image_path <> ''
  and coalesce(si.item_data->>'image_path', '') <> gi.image_path;

with rebuilt_checklist_shares as (
  select
    si.id,
    jsonb_set(
      si.item_data,
      '{items}',
      jsonb_agg(
        case
          when gi.image_path is not null
            and gi.image_path <> ''
            and coalesce(item.value->>'image_path', '') <> gi.image_path
          then jsonb_set(item.value, '{image_path}', to_jsonb(gi.image_path), true)
          else item.value
        end
        order by item.ordinality
      ),
      true
    ) as item_data
  from public.shared_items si
  cross join lateral jsonb_array_elements(si.item_data->'items') with ordinality as item(value, ordinality)
  left join public.gear_items gi on gi.id = (item.value->>'id')::uuid
  where si.checklist_id is not null
    and jsonb_typeof(si.item_data->'items') = 'array'
  group by si.id, si.item_data
)
update public.shared_items si
set item_data = rebuilt.item_data
from rebuilt_checklist_shares rebuilt
where si.id = rebuilt.id
  and si.item_data <> rebuilt.item_data;
