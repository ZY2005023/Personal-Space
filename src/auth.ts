import NextAuth, { getServerSession, type NextAuthOptions } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { verify } from "@node-rs/argon2";
import { createHmac, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { decryptTotp, matchTotp } from "@/lib/crypto";
import { z } from "zod";

const input = z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(1024), code: z.string().min(1).max(128), recovery: z.string().optional() });
// AUTH_URL is our single canonical origin; map it to the stable provider's name.
if (process.env.AUTH_URL) process.env.NEXTAUTH_URL = process.env.AUTH_URL;
export const authOptions: NextAuthOptions = {
  secret: process.env.AUTH_SECRET,
  pages: { signIn: "/login" }, session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
  providers: [Credentials({
    credentials: { username: {}, password: {}, code: {}, recovery: {} },
    async authorize(credentials) {
      const parsed = input.safeParse(credentials); if (!parsed.success || !process.env.AUTH_SECRET || !process.env.TOTP_ENCRYPTION_KEY) return null;
      const data = parsed.data; const prisma = db();
      // A single global account has a persistent fixed-window throttle. Atomic SQL avoids reset races.
      const attempts = await prisma.$queryRaw<{ attempts: number }[]>`
        INSERT INTO login_throttles (key, attempts, window_start) VALUES ('admin', 1, NOW())
        ON CONFLICT (key) DO UPDATE SET
          attempts = CASE WHEN login_throttles.window_start < NOW() - INTERVAL '15 minutes' THEN 1 ELSE login_throttles.attempts + 1 END,
          window_start = CASE WHEN login_throttles.window_start < NOW() - INTERVAL '15 minutes' THEN NOW() ELSE login_throttles.window_start END
        RETURNING attempts`;
      if (attempts[0].attempts > 10) return null;
      const admin = await prisma.adminUser.findUnique({ where: { username: data.username.trim().toLowerCase() } });
      if (!admin || !admin.mfaEnabled || !admin.totpSecretEncrypted || !await verify(admin.passwordHash, data.password)) return null;
      if (data.recovery === "true") {
        const codes = await prisma.recoveryCode.findMany({ where: { adminId: admin.id, usedAt: null } });
        let match: string | undefined;
        for (const code of codes) if (await verify(code.codeHash, data.code.trim())) { match = code.id; break; }
        if (!match) return null;
        const used = await prisma.recoveryCode.updateMany({ where: { id: match, usedAt: null }, data: { usedAt: new Date() } });
        if (used.count !== 1) return null;
      } else {
        const step = matchTotp(decryptTotp(admin.totpSecretEncrypted), data.code.trim()); if (step === null) return null;
        const used = await prisma.adminUser.updateMany({ where: { id: admin.id, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: BigInt(step) } }] }, data: { lastTotpStep: BigInt(step) } });
        if (used.count !== 1) return null;
      }
      return { id: admin.id, name: admin.username, sessionVersion: admin.sessionVersion };
    },
  })],
  callbacks: {
    async jwt({ token, user }) { if (user) { token.adminId = user.id; token.sessionVersion = user.sessionVersion; token.csrfNonce = randomUUID(); } return token; },
    async session({ session, token }) {
      if (!token.adminId || !process.env.AUTH_SECRET || !process.env.DATABASE_URL) return { ...session, user: undefined! };
      const admin = await db().adminUser.findUnique({ where: { id: String(token.adminId) } });
      if (!admin || !admin.mfaEnabled || admin.sessionVersion !== token.sessionVersion) return { ...session, user: undefined! };
      session.user.id = admin.id; session.csrfToken = createHmac("sha256", process.env.AUTH_SECRET).update(String(token.csrfNonce)).digest("hex"); return session;
    },
  },
};
const handler = NextAuth(authOptions);
export const handlers = { GET: handler, POST: handler };
export const auth = () => getServerSession(authOptions);
