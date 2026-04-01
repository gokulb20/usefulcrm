export const BOOTSTRAP_TEMPLATE_CONTENT = {
  "AGENTS.md": "# AGENTS.md - Your Workspace\n\nThis folder is home. Treat it that way.\n",
  "SOUL.md": "# SOUL.md - Who You Are\n\nDescribe the personality and behavior of your agent here.\n",
  "TOOLS.md": "# TOOLS.md - Local Notes\n\nSkills define how tools work. This file is for your specifics.\n",
  "IDENTITY.md": "# IDENTITY.md - Who Am I?\n\nFill this in during your first conversation.\n",
  "USER.md":
    "# USER.md - About Your Human\n\nDescribe yourself and how you'd like the agent to interact with you.\n",
  "HEARTBEAT.md":
    "# HEARTBEAT.md\n\n# Keep this file empty (or with only comments) to skip heartbeat API calls.\n",
  "BOOTSTRAP.md":
    "# BOOTSTRAP.md - Hello, World\n\nYou just woke up. Time to figure out who you are.\n",
} as const;

export type BootstrapTemplateName = keyof typeof BOOTSTRAP_TEMPLATE_CONTENT;
