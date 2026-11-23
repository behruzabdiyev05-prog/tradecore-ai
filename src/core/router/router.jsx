/**
 * Minimal dependency-free router (History API).
 * Netlify serves index.html for every path (see netlify.toml), so deep links work.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { matchPath } from './matchPath.js';

export { matchPath };

const RouterContext = createContext(null);

export function RouterProvider({ children }) {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPop = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to, { replace = false } = {}) => {
    if (to === window.location.pathname) return;
    window.history[replace ? 'replaceState' : 'pushState']({}, '', to);
    setPathname(window.location.pathname);
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo(() => ({ pathname, navigate }), [pathname, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error('useRouter must be used inside <RouterProvider>');
  return ctx;
}

export function Link({ to, children, className, onClick, ...rest }) {
  const { navigate, pathname } = useRouter();
  const active = pathname === to;
  return (
    <a
      href={to}
      className={typeof className === 'function' ? className({ active }) : className}
      aria-current={active ? 'page' : undefined}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    >
      {children}
    </a>
  );
}
