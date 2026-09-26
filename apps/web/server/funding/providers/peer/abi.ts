import "server-only";

import { parseAbi } from "viem";

export const PEER_ESCROW_ABI = parseAbi([
  "event DepositReceived(uint256 indexed depositId, address indexed depositor, address indexed token, uint256 amount, (uint256 min,uint256 max) intentAmountRange, address delegate, address intentGuardian)",
  "function createDeposit((address token,uint256 amount,(uint256 min,uint256 max) intentAmountRange,bytes32[] paymentMethods,(address intentGatingService,bytes32 payeeDetails,bytes data)[] paymentMethodData,(bytes32 code,uint256 minConversionRate,(address adapter,bytes adapterConfig,int16 spreadBps,uint32 maxStaleness) oracleRateConfig)[][] currencies,address delegate,address intentGuardian,bool retainOnEmpty) _params)",
  "function pruneExpiredIntents(uint256 _depositId)",
  "function withdrawDeposit(uint256 _depositId)",
  "event DepositWithdrawn(uint256 indexed depositId, address indexed depositor, uint256 amount)",
]);

export const PEER_CREATE_DEPOSIT_ABI = [PEER_ESCROW_ABI[1]] as const;
export const PEER_WITHDRAW_ABI = [PEER_ESCROW_ABI[2], PEER_ESCROW_ABI[3]] as const;
