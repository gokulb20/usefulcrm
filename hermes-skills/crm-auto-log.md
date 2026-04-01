---
name: crm-auto-log
description: Automatically log CRM interactions from email, calendar, and messages into activities. Includes polling scripts, Gmail/Google Calendar integration, and structured parsing patterns.
version: 1.0.0
---

# CRM Auto-Log

Auto-logging watches external sources (email, calendar, messages) and logs matching interactions as CRM activities. All logged activities go into `crm.duckdb` via the API bridge at `http://localhost:3200`.

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb
API=http://localhost:3200
```

---

## Log Activity via API (base command)

```bash
log_activity() {
  local type="$1" title="$2" contact_id="$3" notes="$4" occurred_at="$5"
  curl -s -X POST "$API/api/activities" \
    -H "Content-Type: application/json" \
    -d "{
      \"type\": \"$type\",
      \"title\": \"$title\",
      \"contact_id\": \"$contact_id\",
      \"notes\": \"$notes\",
      \"occurred_at\": \"$occurred_at\"
    }"
}
```

---

## Auto-Log from Gmail (using `gog` CLI or `himalaya`)

### Find contact ID by email

```bash
find_contact() {
  local email="$1"
  curl -s "$API/api/contacts?q=$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))' "$email")" \
    | jq -r '.[0].id // empty'
}
```

### Log inbound email as activity

```bash
log_email_activity() {
  local from_email="$1"
  local subject="$2"
  local body_excerpt="$3"
  local received_at="$4"

  local contact_id
  contact_id=$(find_contact "$from_email")

  if [ -z "$contact_id" ]; then
    echo "No contact found for $from_email — skipping"
    return 1
  fi

  curl -s -X POST "$API/api/activities" \
    -H "Content-Type: application/json" \
    -d "{
      \"type\": \"email\",
      \"title\": \"Email: $subject\",
      \"contact_id\": \"$contact_id\",
      \"notes\": \"From: $from_email\\n\\n$body_excerpt\",
      \"occurred_at\": \"$received_at\"
    }" | jq -r '.id'
}
```

### Poll Gmail for recent emails (using `gog` CLI)

```bash
#!/bin/bash
# auto-log-gmail.sh — run on a schedule (e.g. every 15 min via cron)
API=http://localhost:3200
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb

# Get emails from last 1 hour
SINCE=$(date -u -v-1H +%Y/%m/%d 2>/dev/null || date -u -d '1 hour ago' +%Y/%m/%d)

# Using himalaya CLI (configure with your Gmail IMAP)
himalaya list --folder INBOX --query "since:$SINCE" --output json 2>/dev/null | \
jq -c '.[]' | while read -r email; do
  FROM=$(echo "$email" | jq -r '.from[0].addr // empty')
  SUBJECT=$(echo "$email" | jq -r '.subject // ""')
  DATE=$(echo "$email" | jq -r '.date // empty')

  [ -z "$FROM" ] && continue

  # Look up contact
  CONTACT_ID=$(curl -s "$API/api/contacts?q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$FROM")" | jq -r '.[0].id // empty')
  [ -z "$CONTACT_ID" ] && continue

  # Log it
  curl -s -X POST "$API/api/activities" \
    -H "Content-Type: application/json" \
    -d "{\"type\":\"email\",\"title\":\"Email: $SUBJECT\",\"contact_id\":\"$CONTACT_ID\",\"occurred_at\":\"$DATE\"}" \
    > /dev/null

  echo "Logged email from $FROM: $SUBJECT"
done
```

---

## Auto-Log from Google Calendar

```bash
#!/bin/bash
# auto-log-calendar.sh — log today's meetings as CRM activities
API=http://localhost:3200
TODAY=$(date +%Y-%m-%d)

# Using gog CLI (Google Calendar)
gog calendar list --from "$TODAY" --to "$TODAY" --output json 2>/dev/null | \
jq -c '.[]' | while read -r event; do
  TITLE=$(echo "$event" | jq -r '.summary // ""')
  START=$(echo "$event" | jq -r '.start.dateTime // empty')
  ATTENDEES=$(echo "$event" | jq -r '.attendees[]?.email // empty' | tr '\n' ' ')

  [ -z "$START" ] && continue

  # Log an activity for each attendee who is a CRM contact
  echo "$event" | jq -r '.attendees[]?.email // empty' | while read -r attendee_email; do
    CONTACT_ID=$(curl -s "$API/api/contacts?q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$attendee_email")" | jq -r '.[0].id // empty')
    [ -z "$CONTACT_ID" ] && continue

    curl -s -X POST "$API/api/activities" \
      -H "Content-Type: application/json" \
      -d "{
        \"type\": \"meeting\",
        \"title\": \"Meeting: $TITLE\",
        \"contact_id\": \"$CONTACT_ID\",
        \"notes\": \"Attendees: $ATTENDEES\",
        \"occurred_at\": \"$START\"
      }" > /dev/null

    echo "Logged meeting '$TITLE' for contact $CONTACT_ID"
  done
done
```

---

## Auto-Log from iMessage / Slack (manual parse)

```bash
# iMessage: use imsg CLI (macOS)
# Log a conversation thread as a CRM activity

LOG_IMESSAGE_THREAD() {
  local phone="$1"
  local summary="$2"

  # Find contact by phone
  CONTACT_ID=$(curl -s "$API/api/contacts?q=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1]))" "$phone")" | jq -r '.[0].id // empty')
  [ -z "$CONTACT_ID" ] && echo "No contact for $phone" && return 1

  curl -s -X POST "$API/api/activities" \
    -H "Content-Type: application/json" \
    -d "{
      \"type\": \"note\",
      \"title\": \"iMessage thread with $phone\",
      \"contact_id\": \"$CONTACT_ID\",
      \"notes\": \"$summary\",
      \"occurred_at\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }" | jq -r '.id'
}

# Example usage:
LOG_IMESSAGE_THREAD "+1-555-0100" "Discussed Q2 renewal. They want a demo next week."
```

---

## Cron Schedule (launchd on macOS)

Set up auto-logging to run every 15 minutes:

```bash
# Create a wrapper script
cat > ~/sudo-workspace/usefulcrm/scripts/auto-log-cron.sh << 'EOF'
#!/bin/bash
cd ~/sudo-workspace/usefulcrm
bash scripts/auto-log-gmail.sh >> /tmp/usefulcrm-autolog.log 2>&1
bash scripts/auto-log-calendar.sh >> /tmp/usefulcrm-autolog.log 2>&1
EOF
chmod +x ~/sudo-workspace/usefulcrm/scripts/auto-log-cron.sh

# Add to crontab (every 15 min)
(crontab -l 2>/dev/null; echo "*/15 * * * * ~/sudo-workspace/usefulcrm/scripts/auto-log-cron.sh") | crontab -

echo "Auto-log cron installed."
```

---

## Dedup Check (avoid logging same activity twice)

```bash
DB=~/sudo-workspace/usefulcrm/api-bridge/crm.duckdb

# Check if activity already logged (same contact + type + title + within 1 hour)
is_duplicate() {
  local contact_id="$1" type="$2" title="$3" occurred_at="$4"
  COUNT=$(duckdb "$DB" -noheader -list "
    SELECT COUNT(*) FROM activities
    WHERE contact_id = '$contact_id'
      AND type = '$type'
      AND title = '${title//\'/\'\'}'
      AND ABS(DATE_DIFF('minute', occurred_at, TIMESTAMPTZ '$occurred_at')) < 60
  ")
  [ "$COUNT" -gt 0 ]
}
```

## Tips

- Run auto-log scripts every 15 minutes via cron to keep the CRM current
- Always resolve email → contact_id before logging; skip if no match
- Use the dedup check to prevent duplicate activity entries
- Log calendar events at end-of-day with a meeting summary note
- For emails, only log external domains (skip internal @yourcompany.com)
