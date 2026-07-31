import { NavLink, Outlet, useLocation } from 'react-router-dom';
import DateRangeShortcuts from './DateRangeShortcuts';
import Select from './Select';
import Logo from './Logo';
import { useDateRange } from '../contexts/DateRangeContext';

const navItems = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/trends', label: '趋势分析' },
  { to: '/fingerprints', label: 'SQL 归类' },
  { to: '/sync', label: '数据管理' },
];

export default function Layout() {
  const location = useLocation();
  const {
    startTime, endTime, setRange,
    dbName, instanceName, setDbName, setInstanceName,
    filterOptions,
  } = useDateRange();

  // 数据管理页不显示全局筛选条件（它有自己独立的选择器）
  const showGlobalFilters = !location.pathname.startsWith('/sync');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* 顶部导航栏 */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200">
        <div className="max-w-[1440px] mx-auto px-6 h-14 flex items-center">
          {/* 左侧 Logo */}
          <div className="flex-shrink-0 mr-8 flex items-center gap-2">
            <Logo size={28} />
            <h1 className="text-base font-semibold whitespace-nowrap">
              <span className="bg-gradient-to-r from-[#6c63ff] to-[#06b6d4] bg-clip-text text-transparent">星河逐影</span>
              <span className="ml-1.5 text-xs font-medium text-gray-400 tracking-wide">SlowTrail</span>
            </h1>
          </div>

          {/* 中间导航链接 */}
          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                    isActive
                      ? 'text-primary bg-primary/5'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>

          {/* 右侧全局筛选条件 */}
          {showGlobalFilters && (
            <div className="ml-auto flex items-center gap-2 flex-shrink-0">
              <Select
                value={dbName}
                onChange={setDbName}
                size="sm"
                placeholder="全部数据库"
                options={[
                  { value: '', label: '全部数据库' },
                  ...filterOptions.dbNames.map((name) => ({ value: name, label: name })),
                ]}
              />
              <Select
                value={instanceName}
                onChange={setInstanceName}
                size="sm"
                placeholder="全部实例"
                options={[
                  { value: '', label: '全部实例' },
                  ...filterOptions.instanceNames.map((name) => ({ value: name, label: name })),
                ]}
              />
              <DateRangeShortcuts
                mode="datetime"
                startTime={startTime}
                endTime={endTime}
                onChange={({ startTime: s, endTime: e }) => setRange(s, e)}
              />
            </div>
          )}

          {/* 刷新按钮（最右侧） */}
          <button
            onClick={() => window.location.reload()}
            className={`${showGlobalFilters ? 'ml-3' : 'ml-auto'} p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors flex-shrink-0`}
            title="刷新页面"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </header>

      {/* 内容区域 */}
      <main className="max-w-[1440px] mx-auto px-6 py-6">
        <Outlet />
      </main>
    </div>
  );
}
