import { useEffect, useState } from "react";

/** 极简路由：pathname 驱动页面，标签筛选继续用 #tag= */
export function navigate(path: string) {
  if (location.pathname + location.search + location.hash === path) return;
  history.pushState(null, "", path);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return path;
}
