import { createSettingsListHandler } from "@/server/operator-settings/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = createSettingsListHandler();
