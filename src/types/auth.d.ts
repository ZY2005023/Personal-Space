import type { DefaultSession } from "next-auth";
declare module "next-auth" {
  interface User { sessionVersion?: number; csrfNonce?: string }
  interface Session { user: { id: string } & DefaultSession["user"]; csrfToken?: string; sessionVersion?: number }
}
