CREATE VIRTUAL TABLE IF NOT EXISTS entry_search USING fts5(
    entry_id UNINDEXED,
    title,
    content_text,
    tokenize = 'unicode61'
);
