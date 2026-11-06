import { env } from "cloudflare:workers";
import { handleApi, type AppEnv } from "@/lib/server";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleApi(request, env as AppEnv);
export const POST = (request: Request) => handleApi(request, env as AppEnv);
