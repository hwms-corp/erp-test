import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Menu, Shield } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useAuth } from '@/hooks/useAuth';
import type { RoleCode } from '@/types';
import { ROLE_LABELS, ROLE_COLORS } from '@/types';

const BREADCRUMBS: Record<string, string> = {
  '/dashboard': '대시보드',
  '/partners': '거래처 관리',
  '/orders': '견적서 관리',
  '/confirmed': '수주 관리',
  '/pos': '발주서 검색',
  '/receiving': '입고 처리',
  '/delivery': '납품 처리',
  '/mail': 'AI 메일함',
};

function getBreadcrumb(pathname: string): string {
  for (const [prefix, label] of Object.entries(BREADCRUMBS)) {
    if (pathname.startsWith(prefix)) return label;
  }
  return '';
}

export function Layout() {
  const { user, signOut } = useAuth();
  const [sideOpen, setSideOpen] = useState(false);
  const location = useLocation();

  if (!user) return null;

  const role = user.role as RoleCode | null;
  const roleColor = role ? ROLE_COLORS[role] : { bg: 'bg-slate-50', text: 'text-slate-700' };
  const breadcrumb = getBreadcrumb(location.pathname);
  const isDashboard = location.pathname === '/dashboard';
  const isMail = location.pathname.startsWith('/mail');

  return (
    <div className="flex h-screen bg-slate-50 font-sans text-slate-900 overflow-hidden">
      {sideOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSideOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 flex flex-col transition-transform duration-200 lg:static lg:translate-x-0 lg:w-60 lg:flex-shrink-0 ${
          sideOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar user={user} onLogout={signOut} onClose={() => setSideOpen(false)} />
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 bg-white border-b border-slate-200 flex items-center justify-between px-4 sm:px-8 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSideOpen(true)}
              className="lg:hidden p-1.5 text-slate-500 hover:text-slate-700 rounded-lg hover:bg-slate-100"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-sm text-slate-500 hidden sm:block">{breadcrumb}</div>
          </div>
          <div className="flex items-center gap-3">
            {role && (
              <span
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium ${roleColor.bg} ${roleColor.text}`}
              >
                <Shield className="w-3 h-3" />
                {ROLE_LABELS[role]}
              </span>
            )}
            <span className="text-sm font-medium text-slate-700 hidden sm:inline">
              {user.name}
            </span>
          </div>
        </header>

        <div className={`flex-1 overflow-y-auto ${isDashboard ? 'p-2 sm:p-3' : 'p-3 sm:p-6'}`}>
          <div className={`mx-auto w-full ${
            isDashboard ? 'max-w-none'
              : isMail ? 'max-w-none lg:max-w-[95%]'
                : 'max-w-7xl'
          }`}>
            <Outlet />
          </div>
        </div>
      </main>
    </div>
  );
}
