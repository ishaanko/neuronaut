import { useEffect, useState } from "react";

// The current time, updated every `every` ms while `on`.
export function useNow(on = true, every = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(t);
  }, [on, every]);
  return now;
}
