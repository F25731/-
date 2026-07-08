import { apiPost } from "@/services/api/request";

export type UserBalance = {
    username: string;
    balanceUsd: string;
    keyName?: string;
    keyBalanceUsd?: string;
    keyLimited?: boolean;
};

export async function fetchUserBalance(keys: string[]) {
    return apiPost<UserBalance>("/api/balance", { keys });
}
