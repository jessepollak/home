import { createSettingsDomainHandlers } from "@/server/operator-settings/handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { GET, PUT } = createSettingsDomainHandlers();
