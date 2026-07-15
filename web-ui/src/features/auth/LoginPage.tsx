import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";

export function LoginPage() {
  const { auth, login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try { await login(username, password); } catch (e) { setError(e instanceof Error ? e.message : "登录失败"); }
    finally { setSubmitting(false); }
  }

  if (auth) return <Navigate to="/assistant" replace />;
  return (
    <main className="flex min-h-full items-center justify-center bg-background p-6">
      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-4 rounded-xl border border-border bg-card p-6 shadow-sm">
        <h1 className="text-2xl font-semibold">登录</h1>
        <label className="block text-sm">用户名<input aria-label="用户名" value={username} onChange={(e) => setUsername(e.target.value)} required className="mt-1 w-full rounded-md border p-2" /></label>
        <label className="block text-sm">密码<input aria-label="密码" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className="mt-1 w-full rounded-md border p-2" /></label>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <button type="submit" disabled={submitting} className="w-full rounded-md bg-primary px-4 py-2 text-primary-foreground disabled:opacity-60">{submitting ? "登录中..." : "登录"}</button>
      </form>
    </main>
  );
}
