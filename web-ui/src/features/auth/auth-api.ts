import { apiRequest } from "@/lib/api-client";

export type UserProfile = { name: string; sub?: string; roles: string[]; email?: string };
export type AuthState = { token: string; user: UserProfile };

export async function login(username: string, password: string): Promise<AuthState> {
  const response = await apiRequest<{ access_token: string; user: UserProfile }>("/v1/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return { token: response.access_token, user: response.user };
}

export async function logout(token: string): Promise<void> {
  await apiRequest<void>("/v1/api/auth/logout", { method: "POST", token });
}
