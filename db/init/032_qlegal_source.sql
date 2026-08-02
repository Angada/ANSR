-- Q-Legal — TWO sources of contracts, one repository.
--
-- SharePoint is the governed source: the nightly scan owns those documents, and
-- the file can always be re-fetched from its web URL. A contract dragged in from
-- someone's device has no such backing — if we don't record where it came from at
-- the moment it lands, that provenance is gone forever, and the estate quietly
-- becomes a mix of governed and ungoverned documents that nobody can tell apart.
--
-- So: same journey (C1 → C2 → registers → obligations → families → vectors),
-- different provenance, and the difference is VISIBLE — in the registry, on the
-- contract page, in the estate map, and as a filter.
--
--   source           already exists: 'sharepoint' | 'upload'
--   source_location  where it came from, in the most specific form we can get:
--                    a SharePoint web URL, or for a device file the relative path
--                    the browser gives us (folder uploads expose webkitRelativePath)
--                    falling back to the filename.
--   source_detail    who put it there and when, plus size/type — the audit answer
--                    to "how did this get into our repository?"
--
-- NOTE on what a browser can and cannot tell us: for security, browsers do NOT
-- expose a file's absolute path on the user's machine. We record the most specific
-- thing available (relative path for a folder drop, else the filename) and never
-- claim more than that — an invented "C:\Users\..." would be a lie.

alter table ql_document add column if not exists source_location text;
alter table ql_document add column if not exists source_detail jsonb not null default '{}'::jsonb;

-- the registry filters and the estate map both group by source
create index if not exists ql_document_source_idx on ql_document(source);

-- Backfill: SharePoint documents already carry their web URL in facts.
update ql_document
   set source_location = facts->>'sp_web_url'
 where source_location is null and facts ? 'sp_web_url';
