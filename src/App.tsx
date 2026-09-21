import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthContext, useAuthProvider } from '@/hooks/useAuth';
import { Layout } from '@/components/Layout';
import { LoginView } from '@/views/LoginView';
import { PartnerListView } from '@/views/PartnerListView';
import { PartnerDetailView } from '@/views/PartnerDetailView';
import { OrderListView } from '@/views/OrderListView';
import { OrderFormView } from '@/views/OrderFormView';
import { OrderPreviewView } from '@/views/OrderPreviewView';
import { ConfirmedView } from '@/views/ConfirmedView';
import { TradeStatementView } from '@/views/TradeStatementView';
import { POFormView } from '@/views/POFormView';
import { POPreviewView } from '@/views/POPreviewView';
import { POSearchView } from '@/views/POSearchView';
import { ReceivingView } from '@/views/ReceivingView';
import { DeliveryView } from '@/views/DeliveryView';
import { DashboardView } from '@/views/DashboardView';
import { MailInboxView } from '@/views/MailInboxView';
import { MailReviewView } from '@/views/MailReviewView';

function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthProvider();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-slate-400 text-sm">로딩 중...</div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  const auth = useAuthProvider();

  return (
    <AuthContext.Provider value={auth}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={auth.user ? <Navigate to="/partners" replace /> : <LoginView />} />

          <Route element={<AuthGate><Layout /></AuthGate>}>
            <Route index element={<Navigate to="/partners" replace />} />
            <Route path="/dashboard" element={<DashboardView />} />
            <Route path="/partners" element={<PartnerListView />} />
            <Route path="/partners/:code" element={<PartnerDetailView />} />

            <Route path="/orders" element={<OrderListView />} />
            <Route path="/orders/new" element={<OrderFormView />} />
            <Route path="/orders/:id/edit" element={<OrderFormView />} />
            <Route path="/orders/:id/preview" element={<OrderPreviewView />} />

            <Route path="/confirmed" element={<ConfirmedView />} />
            <Route path="/confirmed/:id/statement" element={<TradeStatementView />} />

            <Route path="/pos" element={<POSearchView />} />
            <Route path="/pos/new" element={<POFormView />} />
            <Route path="/pos/:id/edit" element={<POFormView />} />
            <Route path="/pos/:id/preview" element={<POPreviewView />} />

            <Route path="/receiving" element={<ReceivingView />} />
            <Route path="/delivery" element={<DeliveryView />} />
            <Route path="/mail" element={<MailInboxView />} />
            <Route path="/mail/:id" element={<MailReviewView />} />
          </Route>

          <Route path="*" element={<Navigate to="/partners" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  );
}
