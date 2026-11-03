import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "../src/lib/db";
import { totp } from "../src/lib/crypto";
export const base = process.env.INTEGRATION_BASE_URL || "http://127.0.0.1:3000";
export async function nextCode() {
  const secrets = JSON.parse(await readFile(process.env.INTEGRATION_CREDENTIAL_FILE||"work/integration/secrets.json","utf8"));
  while (true) { const admin = await db().adminUser.findUniqueOrThrow({ where: { username: "integration-owner" }, select: { lastTotpStep: true } }), step = Math.floor(Date.now()/30000); if (admin.lastTotpStep === null || Number(admin.lastTotpStep)<step) return totp(secrets.testSecret,step); await delay(500); }
}
export class AuthClient {
  private cookies = new Map<string,string>(); csrf = ""; adminId = "";
  async raw(path: string, options: RequestInit = {}) {
    const headers = new Headers(options.headers); headers.set("Cookie",[...this.cookies].map(([key,value])=>`${key}=${value}`).join("; "));
    if (options.method && options.method !== "GET") { headers.set("Origin",base); if(this.csrf)headers.set("X-CSRF-Token",this.csrf); }
    const response=await fetch(base+path,{...options,headers,redirect:"manual"});
    for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(";");const n=pair.indexOf("=");if(n>0){const key=pair.slice(0,n),value=pair.slice(n+1);if(value)this.cookies.set(key,value);else this.cookies.delete(key);}}
    return response;
  }
  async login(recoveryCode?: string, passwordOverride?: string) {
    const secrets=JSON.parse(await readFile(process.env.INTEGRATION_CREDENTIAL_FILE||"work/integration/secrets.json","utf8")), csrf=await(await this.raw("/api/auth/csrf")).json();
    const result=await(await this.raw("/api/auth/callback/credentials",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({csrfToken:csrf.csrfToken,username:"integration-owner",password:passwordOverride||secrets.testPassword,code:recoveryCode||await nextCode(),recovery:recoveryCode?"true":"false",callbackUrl:base+"/admin",json:"true"})})).json();
    if(String(result.url).includes("error="))throw new Error("Real Auth.js login failed");
    const session=await(await this.raw("/api/auth/session")).json();if(!session.user?.id||!session.csrfToken)throw new Error("Authenticated session missing");this.csrf=session.csrfToken;this.adminId=session.user.id;
  }
  async json(path: string, method="GET", body?: unknown, status=200, extra: Record<string,string>={}) {
    const headers = { ...extra, ...(body!==undefined && !(body instanceof FormData)?{"Content-Type":"application/json"}:{}) };
    const response=await this.raw(path,{method,headers,body:body instanceof FormData?body:body===undefined?undefined:JSON.stringify(body)});
    if(response.status===204&&status===204)return {value:{data:undefined},etag:response.headers.get("etag")};
    const value=await response.json();if(response.status!==status)throw new Error(`${method} ${path}: expected ${status}, received ${response.status}: ${JSON.stringify(value)}`);return {value,etag:response.headers.get("etag")};
  }
  async proof(operation: string){const secrets=JSON.parse(await readFile(process.env.INTEGRATION_CREDENTIAL_FILE||"work/integration/secrets.json","utf8"));return (await this.json("/api/auth/security/reauthenticate","POST",{operation,password:secrets.testPassword,code:await nextCode(),recovery:false})).value.data.token as string;}
}
