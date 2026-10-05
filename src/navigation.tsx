import {
  createContext,
  useContext,
  type AnchorHTMLAttributes,
  type ReactNode,
} from "react";

const NavigateContext = createContext<(to: string) => void>((to) => {
  location.hash = to;
});
const HrefContext = createContext<(to: string) => string>((to) => `#${to}`);
export function NavigationProvider({
  value,
  href,
  children,
}: {
  value: (to: string) => void;
  href: (to: string) => string;
  children: ReactNode;
}) {
  return (
    <NavigateContext.Provider value={value}>
      <HrefContext.Provider value={href}>{children}</HrefContext.Provider>
    </NavigateContext.Provider>
  );
}
/** Returns the app's in-place navigation function. */
export const useNavigate = () => useContext(NavigateContext);

/**
 * A real link to an app route: it can be opened in a new tab, copied or
 * shared, while a plain click still navigates in place.
 */
export default function Link({
  to,
  onClick,
  ...props
}: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const navigate = useNavigate();
  const href = useContext(HrefContext);
  return (
    <a
      {...props}
      href={href(to)}
      onClick={(e) => {
        onClick?.(e);
        if (
          e.defaultPrevented ||
          e.button !== 0 ||
          e.metaKey ||
          e.ctrlKey ||
          e.shiftKey ||
          e.altKey
        )
          return;
        e.preventDefault();
        navigate(to);
      }}
    />
  );
}
