import { loadEnvConfig } from "@next/env";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";
import { db } from "../src/lib/db";
import { prepareAdministrator, initializeAdministrator } from "../src/lib/admin-initialization";
import { equal } from "../src/lib/crypto";
let clientOpened = false;
async function question(prompt: string, hidden = false) {
  process.stdout.write(prompt);
  const output = new Writable({ write(chunk, _encoding, done) { if (hidden) done(); else process.stdout.write(chunk, done); } });
  const rl = createInterface({ input: process.stdin, output, terminal: true, historySize: 0 });
  const controller = new AbortController(); rl.once("SIGINT", () => controller.abort());
  try { return await rl.question("", { signal: controller.signal }); }
  finally { rl.close(); output.end(); if (hidden) process.stdout.write("\n"); }
}
async function main() {
  if (process.argv.slice(2).join(" ") !== "--create" || !process.stdin.isTTY || !process.stdout.isTTY) {
    if (process.argv.length > 2) process.exitCode = 1;
    console.error("Preparation only. After database authorization, use an interactive terminal: npm run admin:init -- --create. Password arguments, redirected input and unattended execution are refused."); return;
  }
  loadEnvConfig(process.cwd());
  const key = process.env.TOTP_ENCRYPTION_KEY || "";
  if (!process.env.DATABASE_URL || Buffer.byteLength(process.env.AUTH_SECRET || "") < 32 || Buffer.from(key, "base64").length !== 32 || Buffer.from(key, "base64").toString("base64") !== key) throw new Error("Configure the existing database and independent authentication/encryption keys first.");
  clientOpened = true;
  if (await db().adminUser.count() !== 0) throw new Error("An administrator already exists. Initialization is refused.");
  if (await question("This will create the sole administrator in the configured database. Type CREATE ADMIN to continue: ") !== "CREATE ADMIN") return;
  const username = await question("Username (3-64 lowercase ASCII characters): ");
  let password = await question("Password (15-128 characters; hidden): ", true), repeat = await question("Confirm password (hidden): ", true);
  if (!equal(password, repeat)) throw new Error("Passwords do not match.");
  const prepared = await prepareAdministrator(username, password); password = ""; repeat = "";
  process.stdout.write("Add this setup key to your authenticator. Do not share or capture this terminal.\n" + prepared.secret + "\n");
  const result = await initializeAdministrator(prepared, await question("Authenticator code (hidden): ", true));
  process.stdout.write("Administrator created. Store these recovery codes offline; each works once.\n" + result.recoveryCodes.join("\n") + "\nWait for the next authenticator code before signing in.\n");
}
main().catch(() => { console.error("Initialization stopped. Verify input/configuration and database state before retrying; no secret details are logged."); process.exitCode = 1; }).finally(async () => { if (clientOpened) await db().$disconnect(); });
