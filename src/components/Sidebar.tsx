import { NavLink } from 'react-router-dom';
import {
  FileText, ShoppingCart, ArrowDownRight, Building2,
  CheckCircle2, Truck, User, LogOut, X, LayoutDashboard, Inbox,
} from 'lucide-react';
import type { RoleCode } from '@/types';
import { ROLE_LABELS, ROLE_COLORS, ROLE_ACCESS } from '@/types';
import type { AppUser } from '@/types';

interface NavItem {
  path: string;
  label: string;
  icon: typeof Building2;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

const allNavGroups: NavGroup[] = [
  {
    group: '공통',
    items: [
      { path: '/partners', label: '거래처 관리', icon: Building2 },
      { path: '/dashboard', label: '대시보드', icon: LayoutDashboard },
      { path: '/mail', label: 'AI 메일함', icon: Inbox },
    ],
  },
  {
    group: '영업',
    items: [
      { path: '/orders', label: '견적서 관리', icon: FileText },
      { path: '/confirmed', label: '수주 관리', icon: CheckCircle2 },
    ],
  },
  {
    group: '구매',
    items: [
      { path: '/pos', label: '발주서 관리', icon: ShoppingCart },
      { path: '/receiving', label: '입고 관리', icon: ArrowDownRight },
    ],
  },
  {
    group: '납품',
    items: [{ path: '/delivery', label: '납품 관리', icon: Truck }],
  },
];

interface SidebarProps {
  user: AppUser;
  onLogout: () => void;
  onClose: () => void;
}

export function Sidebar({ user, onLogout, onClose }: SidebarProps) {
  const role = user.role as RoleCode | null;
  const allowed = role ? ROLE_ACCESS[role] : [];
  const visibleGroups = allNavGroups
    .map(g => ({ ...g, items: g.items.filter(n => allowed.includes(n.path as never)) }))
    .filter(g => g.items.length > 0);

  const roleColor = role ? ROLE_COLORS[role] : { bg: 'bg-slate-50', text: 'text-slate-700' };

  return (
    <>
      <div className="h-16 flex items-center px-5 border-b border-slate-800 relative justify-center">
        <img src="/logo.png" alt="HMS" className="h-9" />
        <button onClick={onClose} className="lg:hidden absolute right-3 p-1 text-slate-400 hover:text-white">
          <X className="w-5 h-5" />
        </button>
      </div>

      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        {visibleGroups.map((g, gi) => (
          <div key={g.group}>
            {gi > 0 && <div className="my-2 mx-2 border-t border-slate-700/60" />}
            <div className="px-3 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              {g.group}
            </div>
            <div className="space-y-0.5">
              {g.items.map(item => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  className={({ isActive }) =>
                    `w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl transition-all ${
                      isActive
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                    }`
                  }
                >
                  <item.icon className="w-5 h-5" />
                  <span className="font-medium text-sm">{item.label}</span>
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t border-slate-800">
        <div className="flex items-center gap-2.5 px-2 mb-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${roleColor.bg}`}>
            <User className={`w-3.5 h-3.5 ${roleColor.text}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">{user.name}</div>
            <div className="text-[11px] text-slate-500">{role ? ROLE_LABELS[role] : '미승인'}</div>
          </div>
        </div>
        <button
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 text-sm"
        >
          <LogOut className="w-4 h-4" /> 로그아웃
        </button>
      </div>
    </>
  );
}
