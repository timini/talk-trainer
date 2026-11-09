-- The PowerPoint section a slide is in (its name), from the deck's section list. Null when the deck has none.
ALTER TABLE slides ADD COLUMN section TEXT;
