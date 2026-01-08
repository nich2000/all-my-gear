-- Add start_date and end_date columns to checklists table
ALTER TABLE checklists 
ADD COLUMN IF NOT EXISTS start_date DATE,
ADD COLUMN IF NOT EXISTS end_date DATE;

-- Add comment for documentation
COMMENT ON COLUMN checklists.start_date IS 'Start date of the trip/checklist';
COMMENT ON COLUMN checklists.end_date IS 'End date of the trip/checklist';
