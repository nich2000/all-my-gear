-- Create category_order table to store user's custom category ordering
CREATE TABLE IF NOT EXISTS category_order (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  categories JSONB NOT NULL DEFAULT '[]'::jsonb,
  sort_modes JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
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
