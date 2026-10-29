import { useSyncExternalStore } from "react";

// Paper (the default) or dark. index.html sets data-theme before first paint so a dark page never flashes cream;
// index.css swaps the color variables on it. Canvases and Clerk read colors in JS, so they redraw through useTheme.
export type Theme = "paper" | "dark";
const THEME = "neuronaut:theme";
const listeners = new Set<() => void>();
const current = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "paper");

export function setTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--color-bg");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  listeners.forEach((l) => l());
  localStorage.setItem(THEME, t); // last, so blocked storage only loses the save, not the switch
}

export const useTheme = () =>
  useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, current);
