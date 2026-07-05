-- Move outdoor activity checklist tags from frontend constants into normalized database entities.

create table if not exists public.outdoor_activities (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  display_name text not null,
  normalized_name text not null,
  display_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  constraint outdoor_activities_name_key unique (name)
);

comment on table public.outdoor_activities is 'Global outdoor activity catalog used by checklist activity tags';

insert into public.outdoor_activities (name, display_name, normalized_name, display_order)
values
  ('Adventure Racing', 'Adventure Racing', 'adventure racing', 0),
  ('Alpine Climbing', 'Alpine Climbing', 'alpine climbing', 1),
  ('BASE Jumping', 'BASE Jumping', 'base jumping', 2),
  ('BMX', 'BMX', 'bmx', 3),
  ('Backcountry Camping', 'Backcountry Camping', 'backcountry camping', 4),
  ('Backcountry Skiing', 'Backcountry Skiing', 'backcountry skiing', 5),
  ('Backpacking', 'Backpacking', 'backpacking', 6),
  ('Beach Camping', 'Beach Camping', 'beach camping', 7),
  ('Big Game Hunting', 'Big Game Hunting', 'big game hunting', 8),
  ('Big Wall Climbing', 'Big Wall Climbing', 'big wall climbing', 9),
  ('Bikepacking', 'Bikepacking', 'bikepacking', 10),
  ('Bird Hunting', 'Bird Hunting', 'bird hunting', 11),
  ('Birdwatching', 'Birdwatching', 'birdwatching', 12),
  ('Bouldering', 'Bouldering', 'bouldering', 13),
  ('Bow Hunting', 'Bow Hunting', 'bow hunting', 14),
  ('Bungee Jumping', 'Bungee Jumping', 'bungee jumping', 15),
  ('Bushcraft', 'Bushcraft', 'bushcraft', 16),
  ('Canoe Camping', 'Canoe Camping', 'canoe camping', 17),
  ('Canoeing', 'Canoeing', 'canoeing', 18),
  ('Canyoning', 'Canyoning', 'canyoning', 19),
  ('Car Camping', 'Car Camping', 'car camping', 20),
  ('Caving (Spelunking)', 'Caving (Spelunking)', 'caving (spelunking)', 21),
  ('Coasteering', 'Coasteering', 'coasteering', 22),
  ('Cross-country Skiing', 'Cross-country Skiing', 'cross-country skiing', 23),
  ('Day Hiking', 'Day Hiking', 'day hiking', 24),
  ('Deep Water Soloing', 'Deep Water Soloing', 'deep water soloing', 25),
  ('Desert Camping', 'Desert Camping', 'desert camping', 26),
  ('Desert Expedition', 'Desert Expedition', 'desert expedition', 27),
  ('Downhill Mountain Biking', 'Downhill Mountain Biking', 'downhill mountain biking', 28),
  ('Duathlon', 'Duathlon', 'duathlon', 29),
  ('Enduro', 'Enduro', 'enduro', 30),
  ('Expedition', 'Expedition', 'expedition', 31),
  ('Fastpacking', 'Fastpacking', 'fastpacking', 32),
  ('Fat Biking', 'Fat Biking', 'fat biking', 33),
  ('Fishing', 'Fishing', 'fishing', 34),
  ('Fly Fishing', 'Fly Fishing', 'fly fishing', 35),
  ('Foraging', 'Foraging', 'foraging', 36),
  ('Freediving', 'Freediving', 'freediving', 37),
  ('Geocaching', 'Geocaching', 'geocaching', 38),
  ('Glamping', 'Glamping', 'glamping', 39),
  ('Gravel Cycling', 'Gravel Cycling', 'gravel cycling', 40),
  ('Hang Gliding', 'Hang Gliding', 'hang gliding', 41),
  ('Hot Air Ballooning', 'Hot Air Ballooning', 'hot air ballooning', 42),
  ('Hunting', 'Hunting', 'hunting', 43),
  ('Ice Climbing', 'Ice Climbing', 'ice climbing', 44),
  ('Ice Fishing', 'Ice Fishing', 'ice fishing', 45),
  ('Ice Skating', 'Ice Skating', 'ice skating', 46),
  ('Indoor Climbing', 'Indoor Climbing', 'indoor climbing', 47),
  ('Jungle Camping', 'Jungle Camping', 'jungle camping', 48),
  ('Jungle Expedition', 'Jungle Expedition', 'jungle expedition', 49),
  ('Kayaking', 'Kayaking', 'kayaking', 50),
  ('Kitesurfing', 'Kitesurfing', 'kitesurfing', 51),
  ('Meditation Retreat', 'Meditation Retreat', 'meditation retreat', 52),
  ('Mixed Climbing', 'Mixed Climbing', 'mixed climbing', 53),
  ('Motorcycle Adventure', 'Motorcycle Adventure', 'motorcycle adventure', 54),
  ('Mountain Biking', 'Mountain Biking', 'mountain biking', 55),
  ('Mountaineering', 'Mountaineering', 'mountaineering', 56),
  ('Multi-day Hiking', 'Multi-day Hiking', 'multi-day hiking', 57),
  ('Nature Photography', 'Nature Photography', 'nature photography', 58),
  ('Obstacle Course Racing', 'Obstacle Course Racing', 'obstacle course racing', 59),
  ('Off-road Driving', 'Off-road Driving', 'off-road driving', 60),
  ('Orienteering', 'Orienteering', 'orienteering', 61),
  ('Overlanding', 'Overlanding', 'overlanding', 62),
  ('Packrafting', 'Packrafting', 'packrafting', 63),
  ('Paragliding', 'Paragliding', 'paragliding', 64),
  ('Peak Bagging', 'Peak Bagging', 'peak bagging', 65),
  ('Polar Expedition', 'Polar Expedition', 'polar expedition', 66),
  ('Rafting', 'Rafting', 'rafting', 67),
  ('River Trekking', 'River Trekking', 'river trekking', 68),
  ('Road Cycling', 'Road Cycling', 'road cycling', 69),
  ('Rogaining', 'Rogaining', 'rogaining', 70),
  ('Sailing', 'Sailing', 'sailing', 71),
  ('Scientific Expedition', 'Scientific Expedition', 'scientific expedition', 72),
  ('Scuba Diving', 'Scuba Diving', 'scuba diving', 73),
  ('Sea Kayaking', 'Sea Kayaking', 'sea kayaking', 74),
  ('Ski Mountaineering', 'Ski Mountaineering', 'ski mountaineering', 75),
  ('Ski Touring', 'Ski Touring', 'ski touring', 76),
  ('Skiing', 'Skiing', 'skiing', 77),
  ('Skydiving', 'Skydiving', 'skydiving', 78),
  ('Sledding', 'Sledding', 'sledding', 79),
  ('Snorkeling', 'Snorkeling', 'snorkeling', 80),
  ('Snow Camping', 'Snow Camping', 'snow camping', 81),
  ('Snowboarding', 'Snowboarding', 'snowboarding', 82),
  ('Snowshoeing', 'Snowshoeing', 'snowshoeing', 83),
  ('Spearfishing', 'Spearfishing', 'spearfishing', 84),
  ('Splitboarding', 'Splitboarding', 'splitboarding', 85),
  ('Sport Climbing', 'Sport Climbing', 'sport climbing', 86),
  ('Stand-up Paddleboarding (SUP)', 'Stand-up Paddleboarding (SUP)', 'stand-up paddleboarding (sup)', 87),
  ('Stargazing', 'Stargazing', 'stargazing', 88),
  ('Surfing', 'Surfing', 'surfing', 89),
  ('Survival Training', 'Survival Training', 'survival training', 90),
  ('Swimming', 'Swimming', 'swimming', 91),
  ('Thru-hiking', 'Thru-hiking', 'thru-hiking', 92),
  ('Trad Climbing', 'Trad Climbing', 'trad climbing', 93),
  ('Trail Riding', 'Trail Riding', 'trail riding', 94),
  ('Trail Running', 'Trail Running', 'trail running', 95),
  ('Triathlon', 'Triathlon', 'triathlon', 96),
  ('Ultralight Hiking', 'Ultralight Hiking', 'ultralight hiking', 97),
  ('Ultramarathon', 'Ultramarathon', 'ultramarathon', 98),
  ('Van Life', 'Van Life', 'van life', 99),
  ('Via Ferrata', 'Via Ferrata', 'via ferrata', 100),
  ('Volunteering (Conservation)', 'Volunteering (Conservation)', 'volunteering (conservation)', 101),
  ('Whitewater Kayaking', 'Whitewater Kayaking', 'whitewater kayaking', 102),
  ('Wild Camping', 'Wild Camping', 'wild camping', 103),
  ('Wilderness First Aid Course', 'Wilderness First Aid Course', 'wilderness first aid course', 104),
  ('Wilderness Skills', 'Wilderness Skills', 'wilderness skills', 105),
  ('Wildlife Photography', 'Wildlife Photography', 'wildlife photography', 106),
  ('Windsurfing', 'Windsurfing', 'windsurfing', 107),
  ('Wingsuit Flying', 'Wingsuit Flying', 'wingsuit flying', 108),
  ('Winter Camping', 'Winter Camping', 'winter camping', 109),
  ('Yoga Retreat', 'Yoga Retreat', 'yoga retreat', 110),
  ('Zip Lining', 'Zip Lining', 'zip lining', 111)
on conflict (name) do update
set
  display_name = excluded.display_name,
  normalized_name = excluded.normalized_name,
  display_order = excluded.display_order,
  is_active = true,
  updated_at = now();

create table if not exists public.checklist_activities (
  id uuid primary key default gen_random_uuid(),
  checklist_id uuid not null,
  activity_id uuid not null,
  activity_name text not null,
  created_at timestamptz default now(),
  constraint checklist_activities_checklist_id_fkey
    foreign key (checklist_id) references public.checklists(id) on delete cascade,
  constraint checklist_activities_activity_id_fkey
    foreign key (activity_id) references public.outdoor_activities(id) on delete cascade,
  constraint checklist_activities_checklist_activity_key unique (checklist_id, activity_id)
);

comment on table public.checklist_activities is 'Normalized checklist-to-outdoor-activity links mirrored from checklists.activities';

create index if not exists idx_outdoor_activities_display_name on public.outdoor_activities(display_name);
create index if not exists idx_outdoor_activities_normalized_name on public.outdoor_activities(normalized_name);
create index if not exists idx_checklist_activities_checklist_id on public.checklist_activities(checklist_id);
create index if not exists idx_checklist_activities_activity_id on public.checklist_activities(activity_id);

create or replace function public.sync_checklist_activity_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.checklist_activities
  where checklist_id = new.id;

  insert into public.checklist_activities (checklist_id, activity_id, activity_name)
  select
    new.id,
    oa.id,
    oa.display_name
  from jsonb_array_elements_text(coalesce(new.activities, '[]'::jsonb)) with ordinality as activity_ord(activity_name, ordinality)
  join public.outdoor_activities oa
    on oa.normalized_name = lower(trim(activity_ord.activity_name))
   and oa.is_active = true
  where oa.id = (
    select first_oa.id
    from public.outdoor_activities first_oa
    where first_oa.normalized_name = lower(trim(activity_ord.activity_name))
      and first_oa.is_active = true
    order by first_oa.display_order
    limit 1
  )
  on conflict (checklist_id, activity_id) do nothing;

  return new;
end $$;

drop trigger if exists sync_checklist_activity_links_trigger on public.checklists;
create trigger sync_checklist_activity_links_trigger
  after insert or update of activities on public.checklists
  for each row
  execute function public.sync_checklist_activity_links();

insert into public.checklist_activities (checklist_id, activity_id, activity_name)
select
  c.id,
  oa.id,
  oa.display_name
from public.checklists c
cross join lateral jsonb_array_elements_text(coalesce(c.activities, '[]'::jsonb)) with ordinality as activity_ord(activity_name, ordinality)
join public.outdoor_activities oa
  on oa.normalized_name = lower(trim(activity_ord.activity_name))
 and oa.is_active = true
where oa.id = (
  select first_oa.id
  from public.outdoor_activities first_oa
  where first_oa.normalized_name = lower(trim(activity_ord.activity_name))
    and first_oa.is_active = true
  order by first_oa.display_order
  limit 1
)
on conflict (checklist_id, activity_id) do nothing;

alter table public.outdoor_activities enable row level security;
alter table public.checklist_activities enable row level security;

drop policy if exists outdoor_activities_select_all on public.outdoor_activities;
create policy outdoor_activities_select_all
  on public.outdoor_activities for select to anon, authenticated
  using (is_active);

drop policy if exists checklist_activities_select_visible_checklist on public.checklist_activities;
create policy checklist_activities_select_visible_checklist
  on public.checklist_activities for select to anon, authenticated
  using (public.can_read_checklist(checklist_id));

drop policy if exists checklist_activities_insert_owner on public.checklist_activities;
create policy checklist_activities_insert_owner
  on public.checklist_activities for insert to authenticated
  with check (
    exists (
      select 1
      from public.checklists c
      where c.id = checklist_id
        and c.user_id = auth.uid()
    )
  );

drop policy if exists checklist_activities_delete_owner on public.checklist_activities;
create policy checklist_activities_delete_owner
  on public.checklist_activities for delete to authenticated
  using (
    exists (
      select 1
      from public.checklists c
      where c.id = checklist_id
        and c.user_id = auth.uid()
    )
  );
