---
name: crm-import
description: Import contacts and companies from CSV, vCard (.vcf), or other CRMs into UsefulCRM via DuckDB bulk insert scripts.
version: 1.0.0
---

# CRM Import

Import contacts and companies from external sources into `crm.duckdb`.

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb
```

---

## Import Contacts from CSV

### CSV format expected
```csv
name,email,phone,title,company_name,notes
Jane Smith,jane@acme.com,+1-555-0101,VP Sales,Acme Corp,Met at SaaStr
John Doe,john@stripe.com,+1-555-0102,CTO,Stripe,
```

### Import script

```bash
#!/bin/bash
# import-contacts.sh <csv_file>
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb
CSV_FILE="$1"

if [ -z "$CSV_FILE" ]; then
  echo "Usage: $0 <path-to-contacts.csv>"
  exit 1
fi

echo "Importing contacts from $CSV_FILE..."

# Load CSV into a temp table and upsert into contacts
duckdb "$DB" "
-- Load CSV
CREATE TEMP TABLE import_contacts AS
SELECT * FROM read_csv_auto('$CSV_FILE', header=true);

-- Create companies that don't exist yet
INSERT INTO companies (id, name)
SELECT gen_random_uuid()::VARCHAR, company_name
FROM import_contacts
WHERE company_name IS NOT NULL AND company_name != ''
  AND company_name NOT IN (SELECT name FROM companies)
ON CONFLICT (name) DO NOTHING;

-- Insert contacts (skip existing emails)
INSERT INTO contacts (id, name, email, phone, title, company_id, notes)
SELECT
  gen_random_uuid()::VARCHAR,
  ic.name,
  ic.email,
  ic.phone,
  ic.title,
  (SELECT id FROM companies WHERE name = ic.company_name LIMIT 1),
  ic.notes
FROM import_contacts ic
WHERE ic.email NOT IN (SELECT email FROM contacts WHERE email IS NOT NULL)
   OR ic.email IS NULL;

SELECT 'Imported ' || COUNT(*) || ' contacts' FROM import_contacts;
"

echo "Done."
```

### Run it
```bash
chmod +x import-contacts.sh
./import-contacts.sh ~/Downloads/contacts-export.csv
```

---

## Import Companies from CSV

```bash
#!/bin/bash
# import-companies.sh <csv_file>
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb
CSV_FILE="$1"

duckdb "$DB" "
CREATE TEMP TABLE import_companies AS
SELECT * FROM read_csv_auto('$CSV_FILE', header=true);

INSERT INTO companies (id, name, domain, industry, size, location)
SELECT
  gen_random_uuid()::VARCHAR,
  name,
  domain,
  industry,
  size,
  location
FROM import_companies
WHERE name NOT IN (SELECT name FROM companies)
ON CONFLICT DO NOTHING;

SELECT 'Imported ' || COUNT(*) || ' companies' FROM import_companies;
"
```

---

## Import from vCard (.vcf)

```python
#!/usr/bin/env python3
# import-vcf.py — import contacts from a .vcf file
# Usage: python3 import-vcf.py contacts.vcf

import sys, re, subprocess, uuid, json

def parse_vcf(path):
    contacts = []
    current = {}
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line == 'BEGIN:VCARD':
                current = {}
            elif line == 'END:VCARD':
                if current:
                    contacts.append(current)
            elif line.startswith('FN:'):
                current['name'] = line[3:]
            elif line.startswith('EMAIL') and ':' in line:
                current['email'] = line.split(':',1)[1]
            elif line.startswith('TEL') and ':' in line:
                current['phone'] = line.split(':',1)[1]
            elif line.startswith('ORG:'):
                current['company_name'] = line[4:].split(';')[0]
            elif line.startswith('TITLE:'):
                current['title'] = line[6:]
    return contacts

contacts = parse_vcf(sys.argv[1])
DB = '/Users/gokul/sudo-workspace/usefulcrm/api-bridge/crm.duckdb'

for c in contacts:
    name = c.get('name','').replace("'","''")
    email = c.get('email','').replace("'","''")
    phone = c.get('phone','').replace("'","''")
    title = c.get('title','').replace("'","''")
    company = c.get('company_name','').replace("'","''")
    entry_id = str(uuid.uuid4())

    sql = f"""
    -- Create company if needed
    INSERT INTO companies (id, name) VALUES (gen_random_uuid()::VARCHAR, '{company}')
    ON CONFLICT (name) DO NOTHING;

    -- Insert contact
    INSERT INTO contacts (id, name, email, phone, title, company_id)
    SELECT '{entry_id}', '{name}', NULLIF('{email}',''), NULLIF('{phone}',''), NULLIF('{title}',''),
           (SELECT id FROM companies WHERE name = '{company}' LIMIT 1)
    WHERE NOT EXISTS (SELECT 1 FROM contacts WHERE email = '{email}' AND '{email}' != '');
    """
    subprocess.run(['duckdb', DB, sql], capture_output=True)
    print(f"  Imported: {c.get('name')}")

print(f"\nDone. {len(contacts)} contacts processed.")
```

```bash
python3 import-vcf.py ~/Downloads/contacts.vcf
```

---

## Import from HubSpot Export (CSV)

HubSpot exports contacts with these column names:

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb

duckdb "$DB" "
CREATE TEMP TABLE hubspot AS
SELECT * FROM read_csv_auto('~/Downloads/hubspot-contacts.csv', header=true);

INSERT INTO contacts (id, name, email, phone, title, notes)
SELECT
  gen_random_uuid()::VARCHAR,
  \"First Name\" || ' ' || \"Last Name\" AS name,
  \"Email Address\",
  \"Phone Number\",
  \"Job Title\",
  \"Notes\"
FROM hubspot
WHERE \"Email Address\" NOT IN (SELECT email FROM contacts WHERE email IS NOT NULL)
ON CONFLICT DO NOTHING;

SELECT 'Imported ' || COUNT(*) || ' from HubSpot' FROM hubspot;
"
```

---

## Verify Import

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb

# Check total counts
duckdb "$DB" "SELECT COUNT(*) as contacts FROM contacts; SELECT COUNT(*) as companies FROM companies;"

# Check for contacts with no email
duckdb "$DB" -json "SELECT COUNT(*) as no_email FROM contacts WHERE email IS NULL OR email = ''"

# Check for orphaned contacts (no company link)
duckdb "$DB" -json "SELECT COUNT(*) as no_company FROM contacts WHERE company_id IS NULL"

# Preview recent imports
duckdb "$DB" -json "SELECT name, email, title FROM contacts ORDER BY created_at DESC LIMIT 10"
```

## Tips

- Always deduplicate by email before importing — use `ON CONFLICT DO NOTHING`
- Create companies first, then link contacts to them by `company_id`
- After import, run the verify commands above to check data quality
- For large imports (10k+), use DuckDB's `read_csv_auto` in a single SQL transaction — much faster than row-by-row
