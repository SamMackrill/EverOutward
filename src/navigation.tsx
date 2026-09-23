import { createContext, useContext, type AnchorHTMLAttributes } from "react";

const NavigateContext = createContext<(to: string) => void>((to) => {
  location.hash = to;
});
export const NavigationProvider = NavigateContext.Provider;
/** Returns the app's in-place navigation function. */
export const useNavigate = () => useContext(NavigateContext);

/**
 * A real link to a hash route: it can be opened in a new tab, copied or
 * shared, while a plain click still navigates in place.
 */
export default function Link({
  to,
  onClick,
  ...props
}: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const navigate = useNavigate();
  return (
    <a
      {...props}
      href={`#${to}`}
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
