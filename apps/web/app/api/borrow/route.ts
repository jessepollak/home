import { authorizeSession } from "@/server/auth/authorize";
import { createBorrowHandler } from "@/server/borrowing/handler";
import { getBaseBorrowing } from "@/server/borrowing/rpc";


export const GET = createBorrowHandler({
  authorize: authorizeSession,
  rpc: getBaseBorrowing,
});
