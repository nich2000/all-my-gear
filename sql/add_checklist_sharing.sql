-- Add checklist_id column to shared_items table for checklist sharing support
-- This allows us to reuse the shared_items table for both gear items and checklists

-- Add nullable checklist_id column
ALTER TABLE shared_items
ADD COLUMN IF NOT EXISTS checklist_id UUID REFERENCES checklists(id) ON DELETE CASCADE;

-- Make item_id nullable since we'll have either item_id OR checklist_id
ALTER TABLE shared_items
ALTER COLUMN item_id DROP NOT NULL;

-- Add constraint to ensure either item_id or checklist_id is present
ALTER TABLE shared_items
ADD CONSTRAINT check_item_or_checklist
CHECK (
  (item_id IS NOT NULL AND checklist_id IS NULL) OR
  (item_id IS NULL AND checklist_id IS NOT NULL)
);

-- Add index for checklist_id lookups
CREATE INDEX IF NOT EXISTS idx_shared_items_checklist_id ON shared_items(checklist_id);

-- Update RLS policies to allow checklist sharing
DROP POLICY IF EXISTS "Users can create share links for their items" ON shared_items;
CREATE POLICY "Users can create share links for their items and checklists"
  ON shared_items FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = auth.uid() AND (
      (item_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM gear_items WHERE id = item_id AND user_id = auth.uid()
      )) OR
      (checklist_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM checklists WHERE id = checklist_id AND user_id = auth.uid()
      ))
    )
  );

-- Comments for documentation
COMMENT ON COLUMN shared_items.checklist_id IS 'Reference to checklist being shared (mutually exclusive with item_id)';
COMMENT ON CONSTRAINT check_item_or_checklist ON shared_items IS 'Ensures exactly one of item_id or checklist_id is set';
