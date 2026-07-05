-- Fix the broken Storage object path for "Набор посуды" / MSR Quick 2 System.
update public.gear_items
set image_path = 'a8cf0468-ac26-4897-97a1-68fbac9d5364/c4cbb0f8-8ab3-42f7-871e-e5f43579b174.jpg',
    updated_at = now()
where id = 'c4cbb0f8-8ab3-42f7-871e-e5f43579b174'
  and name = 'Набор посуды'
  and brand = 'MSR'
  and model = 'Quick 2 System'
  and (
    image_path is null
    or image_path <> 'a8cf0468-ac26-4897-97a1-68fbac9d5364/c4cbb0f8-8ab3-42f7-871e-e5f43579b174.jpg'
  );
