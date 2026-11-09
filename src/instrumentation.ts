import type { Instrumentation } from "next";
import { log } from "./lib/logger";

/** Server-render errors are logged without messages, bodies, query strings or credentials. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest = typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined;
  log("error", "next.request.error", {
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
    ...(digest ? { digest } : {}),
  });
};