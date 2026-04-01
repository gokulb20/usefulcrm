# UsefulCRM

AI-powered CRM built on the Useful platform. Connects your data, automates workflows, and gives your team an AI agent that does the work.

## Stack

- **Frontend**: Next.js 15, React 19, Tailwind CSS v4
- **UI**: Radix UI primitives, TipTap editor, Monaco editor
- **State**: Custom workspace + tab state
- **AI**: Vercel AI SDK, streaming chat

## Structure

```
apps/web/          # Next.js frontend (this app)
  app/             # App router pages & API routes
  components/      # UI components
  lib/             # Core utilities
```

## Getting Started

Phase 2 will wire up the Hermes backend. For now, install deps:

```bash
cd apps/web
npm install
npm run dev
```

## Brand

- Background: `#0A0E17`
- Accent: `#00D4FF`
- Font: Inter
