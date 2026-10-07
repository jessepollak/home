import { authorizeSession } from "@/server/auth/authorize";
import { createAccountExportHandler } from "@/server/account-export/handler";

export const maxDuration = 30;

export const GET = createAccountExportHandler({ authorize: authorizeSession });
