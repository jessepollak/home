import { createNativeBaseVerifyHandler } from "@/server/auth/native-base-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const POST = createNativeBaseVerifyHandler();
