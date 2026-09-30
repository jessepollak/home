import { authorizeSession } from "@/server/auth/authorize";
import { createBorrowMarketHandler } from "@/server/borrowing/handler";
import { getBaseBorrowing } from "@/server/borrowing/rpc";


export const GET = createBorrowMarketHandler({
  authorize: authorizeSession,
  rpc: getBaseBorrowing,
});
