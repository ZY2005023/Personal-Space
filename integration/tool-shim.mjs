import { spawnSync } from "node:child_process";
import path from "node:path";
export function tool(name) {
  const root = path.resolve("work/integration"), map = value => path.isAbsolute(value) && path.resolve(value).startsWith(root + path.sep) ? "/integration/" + path.relative(root,value).replaceAll("\\","/") : value;
  const docker = process.env.DOCKER_BINARY || (process.platform === "win32" ? path.join(process.env.LOCALAPPDATA,"Programs/DockerDesktop/resources/bin/docker.exe") : "docker");
  const env = name === "restic" ? ["-e","RESTIC_REPOSITORY", "-e","AWS_ACCESS_KEY_ID", "-e","AWS_SECRET_ACCESS_KEY", "-e","AWS_DEFAULT_REGION=us-east-1", "-e","RESTIC_PASSWORD_FILE=/integration/restic.password"] : ["-e","PGHOST=127.0.0.1", "-e","PGPORT=5432", "-e","PGUSER", "-e","PGPASSWORD", "-e","PGDATABASE", "-e","PGSSLMODE", "-e","PGCONNECT_TIMEOUT=10"];
  const args = process.argv.slice(2).map(map);
  const result = spawnSync(docker, ["exec", ...env, "personal-space-integration-postgres", name, ...(name === "restic" ? ["--cacert","/integration/certs/public.crt"] : []), ...args], { env: process.env, windowsHide: true, encoding: "utf8", maxBuffer: 8*1024*1024 });
  if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr); process.exitCode = result.status ?? 1;
}
