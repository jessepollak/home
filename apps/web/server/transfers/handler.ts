import type { SessionAuthorizer } from "@/server/portfolio/handler";
import {
  TransferReceiptRpcError,
  normalizeAddress,
  normalizeTransactionHash,
  type TransferReceiptStatus,
  type UserOperationProof,
} from "@/server/money-actions/receipt";

export type TransferReceiptReader = (
  transactionHash: `0x${string}`,
  proof?: UserOperationProof,
  signal?: AbortSignal,
) => Promise<TransferReceiptStatus>;

const privateResponseHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization, X-Home-Account-Provider",
} as const;

export function createTransferReceiptHandler(dependencies: {
  authorize: SessionAuthorizer;
  readReceipt: TransferReceiptReader;
}) {
  return async function GET(request: Request): Promise<Response> {
    const boundaryResponse = await dependencies.authorize(request);
    if (!boundaryResponse.ok) return boundaryResponse;

    const parameters = new URL(request.url).searchParams;
    for (const key of parameters.keys()) {
      if (key !== "hash" && key !== "userOpHash" && key !== "sender") {
        return invalidRequest();
      }
    }

    let transactionHash: `0x${string}`;
    let proof: UserOperationProof | undefined;
    try {
      if (
        parameters.getAll("hash").length !== 1 ||
        parameters.getAll("userOpHash").length > 1 ||
        parameters.getAll("sender").length > 1
      ) {
        throw new Error();
      }
      transactionHash = normalizeTransactionHash(parameters.get("hash") ?? "");
      const userOperationHash = parameters.get("userOpHash");
      const sender = parameters.get("sender");
      if ((userOperationHash === null) !== (sender === null)) throw new Error();
      if (userOperationHash !== null && sender !== null) {
        proof = {
          userOperationHash: normalizeTransactionHash(userOperationHash),
          sender: normalizeAddress(sender),
        };
      }
    } catch {
      return invalidRequest();
    }

    try {
      return privateJson(
        await dependencies.readReceipt(transactionHash, proof, request.signal),
        200,
      );
    } catch (error) {
      const message =
        error instanceof TransferReceiptRpcError
          ? "Transaction confirmation is temporarily unavailable."
          : "Transaction confirmation could not be checked.";
      return privateJson(
        { error: { code: "RECEIPT_UNAVAILABLE", message } },
        502,
      );
    }
  };
}

function invalidRequest(): Response {
  return privateJson(
    {
      error: {
        code: "INVALID_TRANSACTION_HASH",
        message: "A valid transaction hash and complete operation proof are required.",
      },
    },
    400,
  );
}

function privateJson(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: privateResponseHeaders });
}
