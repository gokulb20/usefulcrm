---
name: documents
description: Document management with markdown files, always-on entry documents linked through the documents table, and mutation/edit logs for CRM entries. Use when creating or updating row notes, entry notes, detail pages, or document-linked CRM content.
metadata: { "hermes": { "inject": true, "always": true, "emoji": "📄" } }
---

# CRM Documents

This skill covers document management, cross-nesting, and entry detail pages. For workspace fundamentals, see the parent **crm** skill (`crm/SKILL.md`). For creating objects, see **object-builder** (`crm/object-builder/SKILL.md`).

---

## Document Management

Documents are markdown files in `{{WORKSPACE_PATH}}/**`. The DuckDB `documents` table tracks metadata only; the `.md` file IS the content.

## Default Rule: Every Entry Needs a Connected Document

Treat the entry document as the default long-form companion to the row.

Mandatory defaults:

- Create or reuse a connected entry document whenever you create an entry and have enough information to derive a sane filename/title.
- When updating an entry, ensure a connected document exists before finishing the task. If it is missing, create it.
- Keep the document registered in DuckDB `documents` with `entry_id`, `parent_object_id`, and `file_path`.
- If the user asks to add or change anything on an entry, update the connected document too.
- Append a concise timestamped activity log entry for every meaningful mutation so the document acts as an edit log, not just a static page.

### Create Document

1. Write the `.md` file: `write {{WORKSPACE_PATH}}/projects/roadmap.md`
2. Insert metadata into DuckDB:

```sql
INSERT INTO documents (title, icon, file_path, parent_id, sort_order)
VALUES ('Roadmap', 'map', 'projects/roadmap.md', '<parent_doc_id>', 0);
```

### Cross-Nesting

- **Document under Object**: Set `parent_object_id` on the document. Place `.md` file inside the object's directory.
- **Object under Document**: Set `parent_document_id` on the object. Place object directory inside the document's directory.

---

## Notes Field vs Entry Documents

These are **not the same thing**:

- **`Notes` field**: a `richtext` value stored in DuckDB `entry_fields`
- **Entry document**: a standalone `.md` file on disk, linked to the entry through the `documents` table

When the user says:

- "fill in notes for each entry"
- "add notes to this row"
- "add a note to this entry"
- "write descriptions for all rows"
- "add detailed writeups"
- "put the outreach draft into each influencer notes page"
- "create entry docs"

default to the **connected entry document**.

If the user truly means the `Notes` field, they will usually talk about:

- a table column
- richtext field values
- filtering/sorting by Notes
- SQL updates to `entry_fields`

If they explicitly ask to update the `Notes` field/column, update that DuckDB value **and** sync the connected entry document unless they clearly ask you not to.

If they mean entry documents, they are talking about:

- markdown pages
- the entry detail panel
- prose content, drafts, meeting notes, SOPs, long-form notes
- files visible under the object in the sidebar

---

## Entry Detail Pages

Each entry in an object should have a markdown file that acts as its detail page and running edit log in the entry panel.

**CRITICAL:** New entry documents should use **human-readable filenames**, not raw UUID filenames. The file must also be registered in DuckDB `documents` with `entry_id`, `parent_object_id`, and `file_path`.

### Required storage model

For every entry document:

1. Reuse the existing linked document if one already exists for the entry
2. Otherwise write a human-readable markdown file inside the object directory
3. Insert/update a row in `documents` linking the entry to that file
4. Update the markdown content and append the mutation log entry

Before creating a new file, resolve any existing document:

```sql
SELECT id, title, file_path
FROM documents
WHERE entry_id = '<entry_id>'
ORDER BY updated_at DESC
LIMIT 1;
```

```sql
INSERT INTO documents (title, file_path, parent_object_id, entry_id)
VALUES (
  'Mike Murphy',
  'marketing/influencer/yt-mikemurphy-001.md',
  (SELECT id FROM objects WHERE name = 'influencer'),
  'yt-mikemurphy-001'
);
```

### Naming convention (MANDATORY)

Use this filename structure for entry documents:

`{human_readable_slug}-{sequence}.md`

Examples:

- `acme-corp-001.md`
- `jane-smith-001.md`
- `q2-renewal-deal-001.md`

If the entry clearly belongs to a source/domain where a prefix helps, include it:

- `yt-mikemurphy-001.md` for YouTube creators
- `x-somehandle-001.md` for X/Twitter creators

### How to choose the slug

Use the first strong human-readable identifier available:

1. `Document Slug`, `Slug`, or `File Slug` field if it exists
2. For YouTube creators: extract the handle from `YouTube URL` and prefix `yt-`
3. Otherwise use the primary text label, such as:
   - `Title`
   - `Channel Name`
   - `Creator Name`
   - `Full Name`
   - `Name`
   - `Company Name`
   - `Deal Name`
   - `Case Number`
   - `Invoice Number`

Examples:

- `https://www.youtube.com/@MikeMurphy` -> `yt-mikemurphy-001.md`
- `Creator Name = Jane Smith` -> `jane-smith-001.md`
- `Company Name = Acme Corp` -> `acme-corp-001.md`

### Default content model

Keep the entry document readable for humans and useful as an audit trail. A good default shape is:

```markdown
# Jane Smith

## Summary
Current state of the entry in plain English.

## Notes
User-facing notes, drafts, follow-ups, or other long-form details.

## Activity Log
### 2026-03-30T12:34:56Z - Entry updated
- Changed `Status`: `New` -> `Qualified`
- Added note: Follow up on Thursday about pricing
```

Update the current sections in place and append new log items instead of rewriting history.

### NEVER do these

- Do **NOT** default to `{entry_id}.md` for new documents
- Do **NOT** confuse entry documents with the `Notes` richtext field
- Do **NOT** create a markdown file without also inserting/updating the `documents` table row
- Do **NOT** write human-readable files and leave them orphaned from metadata

### Backward compatibility

Older workspaces may still have legacy `{entry_id}.md` files. Those can continue to work, but **new** entry documents should follow the human-readable naming convention above.

---

## Creating One Entry Document

Create or repair the connected entry `.md` file whenever the user creates an entry, mentions notes on the row/entry, or makes a mutation and no document exists yet.

Example:

```bash
cat > {{WORKSPACE_PATH}}/marketing/influencer/yt-mikemurphy-001.md << 'MD'
# Draft Outreach Email

To: hello@mikemurphy.co
Subject: Partnership idea

Hi Mike,

I loved your AI Handyman breakdowns. UsefulCRM is launching a workflow-native AI platform for builders who want serious control over execution, memory, and automation.

Would you be open to testing it and discussing a possible sponsorship?
MD
```

Then register it:

```sql
INSERT INTO documents (title, file_path, parent_object_id, entry_id)
VALUES (
  'Mike Murphy',
  'marketing/influencer/yt-mikemurphy-001.md',
  (SELECT id FROM objects WHERE name = 'influencer'),
  'yt-mikemurphy-001'
)
ON CONFLICT (file_path) DO UPDATE
SET title = excluded.title,
    parent_object_id = excluded.parent_object_id,
    entry_id = excluded.entry_id,
    updated_at = now();
```

---

## Batch Creating Entry Documents

When the user asks for docs for many entries, or asks to add notes/details across many entries, create/update markdown files plus `documents` rows. Only update the `Notes` field in SQL when they explicitly want that field changed too.

### Workflow

1. Query entries and the fields needed to build filenames/titles
2. Derive a human-readable filename for each entry
3. Write one `.md` file per entry under the object directory
4. Insert/update one `documents` row per file
5. Append or update each file's `## Notes` and `## Activity Log` sections to capture the requested changes

### Example: create docs for every influencer

```bash
duckdb {{WORKSPACE_PATH}}/workspace.duckdb -json "
SELECT
  entry_id,
  \"Creator Name\",
  \"Channel Name\",
  \"YouTube URL\"
FROM v_influencer
ORDER BY \"Creator Name\"
"
```

Then for each row:

```bash
# Example row:
# entry_id = yt-mikemurphy-001
# youtube url = https://www.youtube.com/@MikeMurphy

cat > {{WORKSPACE_PATH}}/marketing/influencer/yt-mikemurphy-001.md << 'MD'
# Influencer Notes

## Outreach draft

...
MD
```

Register each file:

```sql
INSERT INTO documents (title, file_path, parent_object_id, entry_id)
VALUES (
  'Mike Murphy',
  'marketing/influencer/yt-mikemurphy-001.md',
  (SELECT id FROM objects WHERE name = 'influencer'),
  'yt-mikemurphy-001'
)
ON CONFLICT (file_path) DO UPDATE
SET title = excluded.title,
    parent_object_id = excluded.parent_object_id,
    entry_id = excluded.entry_id,
    updated_at = now();
```

---

## Standalone Documents vs Entry Documents

Not every markdown file under an object directory is automatically an entry document.

- **Entry document**: has a corresponding `documents` row with `entry_id` set
- **Standalone document under an object**: has no `entry_id` link; it is just a nested document in that folder

Examples:

- `marketing/influencer/yt-mikemurphy-001.md` with `documents.entry_id = 'yt-mikemurphy-001'` -> entry document
- `marketing/influencer/outreach-playbook.md` with no `entry_id` -> standalone object-level document

If a markdown file is meant to be the entry page, always register it in `documents`.

## Sync on Entry Mutations

After **any** meaningful entry mutation:

1. Resolve the linked entry document by `documents.entry_id`
2. Create the document if it does not exist yet
3. Update the relevant prose sections (`Summary`, `Notes`, drafts, follow-ups, etc.)
4. Append a timestamped `Activity Log` entry describing the delta

This applies to:

- field value changes
- explicit `Notes` field updates
- status/owner/priority changes
- user requests to "add", "note", "log", "remember", or otherwise attach information to an entry
