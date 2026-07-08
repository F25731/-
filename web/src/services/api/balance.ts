import { apiPost } from "@/services/api/request";

export type UserBalance = {
    username: string;
    balanceUsd: string;
};

export async function fetchUserBalance(keys: string[]) {
    return apiPost<UserBalance>("/api/balance", { keys });
}
