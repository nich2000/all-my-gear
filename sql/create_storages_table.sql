-- Create storages table
CREATE TABLE IF NOT EXISTS storages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
