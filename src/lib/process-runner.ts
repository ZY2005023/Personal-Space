import { spawn } from "node:child_process";
export async function runCommand(file: string, args: string[], options: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const script = /\.[cm]?js$/i.test(file);
    const child = spawn(script ? process.execPath : file, script ? [file, ...args] : args, { env: options.env || process.env, windowsHide: true, shell: false, stdio: ["ignore", "pipe", "ignore"] });
    let output = Buffer.alloc(0), timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); const force = setTimeout(() => child.kill("SIGKILL"), 3000); force.unref(); }, options.timeoutMs || 1800000); timer.unref();
    child.stdout.on("data", (chunk: Buffer) => { output = Buffer.concat([output, chunk]).subarray(-1024 * 1024); });
    child.once("error", () => { clearTimeout(timer); reject(new Error("Required backup tool could not start")); });
    child.once("close", code => { clearTimeout(timer); if (timedOut || code !== 0) reject(new Error("Backup tool did not complete successfully")); else resolve(output.toString("utf8")); });
  });
}
