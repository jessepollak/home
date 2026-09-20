import { authorizeFundingSession, getFundingCore } from "@/server/funding/core/runtime";
import {
  handleFundingOpenOrderGet,
  handleFundingOrderPost,
} from "./handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const postDependencies = {
  authorize: authorizeFundingSession,
  createOrder: (...args: Parameters<ReturnType<typeof getFundingCore>["createOrder"]>) =>
    getFundingCore().createOrder(...args),
};
const getDependencies = {
  authorize: authorizeFundingSession,
  getOpenOrder: (...args: Parameters<ReturnType<typeof getFundingCore>["getOpenOrder"]>) =>
    getFundingCore().getOpenOrder(...args),
};

export function POST(request: Request): Promise<Response> {
  return handleFundingOrderPost(request, postDependencies);
}

export function GET(request: Request): Promise<Response> {
  return handleFundingOpenOrderGet(request, getDependencies);
}
