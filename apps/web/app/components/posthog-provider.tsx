"use client";

// PostHog analytics removed for UsefulCRM
// This is a passthrough wrapper kept for API compatibility

export function PostHogProvider({
  children,
}: {
  children: React.ReactNode;
  anonymousId?: string;
  personInfo?: unknown;
  privacyMode?: boolean;
}) {
  return <>{children}</>;
}
