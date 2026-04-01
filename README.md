# UsefulCRM

AI-powered business operations for small teams. Part of the Useful Tools subscription ($250/mo).

One subscription. Everything connected. Your AI agent runs it all.

## What's Included

- **AI Employee** (Crewm8) — handles CRM, email, research, outreach, meeting prep
- **Website Generator** — give us your info, get a clean, simple website
- **Contact Management** — relationships, follow-ups, deal tracking
- **Social Media** — basic scheduling and posting
- **Basic Accounting** — invoicing, payment tracking

## Architecture

Built on [Hermes Agent](https://github.com/NousResearch/hermes-agent) (not OpenClaw). The agent runtime handles all AI operations: tool calling, memory, skills, background jobs.

Frontend: Next.js + React + Tailwind
Database: DuckDB (local, embedded)
Agent: Hermes (self-improving, 100+ skills)

## Status

🚧 Under active development. Refactoring from DenchClaw/OpenClaw to Hermes.

## License

MIT
