import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { LoginPage } from "@/features/auth/LoginPage";
import { useAuth } from "@/features/auth/AuthProvider";

export function ProtectedRoute() {
  const { auth } = useAuth();
  return auth ? <Outlet /> : <Navigate to="/login" replace />;
}

const Page = ({ title }: { title: string }) => <main className="p-6"><h1>{title}</h1></main>;

export function AppRouter() {
  return <Routes>
    <Route path="/login" element={<LoginPage />} />
    <Route element={<ProtectedRoute />}>
      <Route path="/assistant/:threadId?" element={<Page title="智能助理" />} />
      <Route path="/workflows" element={<Page title="工作流" />} />
      <Route path="/workflows/:workflowId/:threadId?" element={<Page title="工作流运行" />} />
      <Route path="/knowledge" element={<Page title="知识库" />} />
      <Route path="/knowledge/:documentId" element={<Page title="文档详情" />} />
    </Route>
    <Route path="*" element={<Navigate to="/assistant" replace />} />
  </Routes>;
}
