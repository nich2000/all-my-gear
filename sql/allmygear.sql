-----------------------------------------------------------------------------------------------------------------------
-----------------------------------------------------------------------------------------------------------------------
CREATE TABLE public.category_order (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_modes jsonb DEFAULT '{}'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT category_order_pkey PRIMARY KEY (id),
  CONSTRAINT category_order_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
-- Create index on user_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_category_order_user_id ON category_order(user_id);

-- Enable Row Level Security
ALTER TABLE category_order ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see their own category order
CREATE POLICY "Users can view their own category order"
  ON category_order
  FOR SELECT
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own category order
CREATE POLICY "Users can insert their own category order"
  ON category_order
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own category order
CREATE POLICY "Users can update their own category order"
  ON category_order
  FOR UPDATE
  USING (auth.uid() = user_id);

-- Policy: Users can delete their own category order
CREATE POLICY "Users can delete their own category order"
  ON category_order
  FOR DELETE
  USING (auth.uid() = user_id);

-----------------------------------------------------------------------------------------------------------------------
-----------------------------------------------------------------------------------------------------------------------
CREATE TABLE public.checklists (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text,
  activities jsonb DEFAULT '[]'::jsonb,
  items jsonb DEFAULT '[]'::jsonb,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  start_date date,
  end_date date,
  CONSTRAINT checklists_pkey PRIMARY KEY (id),
  CONSTRAINT checklists_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
COMMENT ON COLUMN checklists.start_date IS 'Start date of the trip/checklist';
COMMENT ON COLUMN checklists.end_date IS 'End date of the trip/checklist';
-----------------------------------------------------------------------------------------------------------------------
-----------------------------------------------------------------------------------------------------------------------

CREATE TABLE public.gear_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  category text,
  name text NOT NULL,
  brand text,
  model text,
  weight integer DEFAULT 0,
  price numeric DEFAULT 0,
  year integer,
  rating integer DEFAULT 0,
  image_path text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  order_index integer,
  comment text,
  storage_id uuid,
  CONSTRAINT gear_items_pkey PRIMARY KEY (id),
  CONSTRAINT gear_items_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT gear_items_storage_id_fkey FOREIGN KEY (storage_id) REFERENCES public.storages(id)
);
-----------------------------------------------------------------------------------------------------------------------
-----------------------------------------------------------------------------------------------------------------------

CREATE TABLE public.public_gear_shares (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  share_token text NOT NULL UNIQUE,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT public_gear_shares_pkey PRIMARY KEY (id),
  CONSTRAINT public_gear_shares_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
-----------------------------------------------------------------------------------------------------------------------
-----------------------------------------------------------------------------------------------------------------------

CREATE TABLE public.shared_items (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  share_code character varying NOT NULL UNIQUE,
  item_id uuid,
  owner_id uuid NOT NULL,
  item_data jsonb NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  expires_at timestamp with time zone NOT NULL,
  checklist_id uuid,
  CONSTRAINT shared_items_pkey PRIMARY KEY (id),
  CONSTRAINT shared_items_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES auth.users(id)
);
COMMENT ON COLUMN shared_items.checklist_id IS 'Reference to checklist being shared (mutually exclusive with item_id)';
-- COMMENT ON CONSTRAINT check_item_or_checklist ON shared_items IS 'Ensures exactly one of item_id or checklist_id is set';
-----------------------------------------------------------------------------------------------------------------------
-----------------------------------------------------------------------------------------------------------------------

CREATE TABLE public.storages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT storages_pkey PRIMARY KEY (id),
  CONSTRAINT storages_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
-- Add RLS policies for storages
ALTER TABLE storages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own storages"
  ON storages FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own storages"
  ON storages FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own storages"
  ON storages FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own storages"
  ON storages FOR DELETE
  USING (auth.uid() = user_id);

-- Add storage_id column to gear_items table
ALTER TABLE gear_items
ADD COLUMN IF NOT EXISTS storage_id UUID REFERENCES storages(id) ON DELETE SET NULL;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_gear_items_storage_id ON gear_items(storage_id);
CREATE INDEX IF NOT EXISTS idx_storages_user_id ON storages(user_id);

-- Add comment for documentation
COMMENT ON TABLE storages IS 'Storage locations for gear items (e.g., garage, closet, shed)';
COMMENT ON COLUMN gear_items.storage_id IS 'Reference to the storage location where this item is kept';
-----------------------------------------------------------------------------------------------------------------------
-----------------------------------------------------------------------------------------------------------------------
