import { useSyncExternalStore } from "react";

// The how-to-play walkthrough opens by itself on a first visit, once.
const SEEN = "neuronaut:seen-howto";
export const firstVisit = () => !localStorage.getItem(SEEN);
export const markSeen = () => localStorage.setItem(SEEN, "1");

// Paper (the default) or dark. index.html sets data-theme before first paint so a dark page never flashes cream;
// index.css swaps the color variables on it. Canvases and Clerk read colors in JS, so they redraw through useTheme.
export type Theme = "paper" | "dark";
const THEME = "neuronaut:theme";
const PAPER_BG = "#ece7dc";
const listeners = new Set<() => void>();
const current = (): Theme => (document.documentElement.dataset.theme === "dark" ? "dark" : "paper");

export function setTheme(t: Theme) {
  localStorage.setItem(THEME, t);
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t === "dark" ? "#000" : PAPER_BG);
  listeners.forEach((l) => l());
}

export const useTheme = () =>
  useSyncExternalStore((l) => {
    listeners.add(l);
    return () => listeners.delete(l);
  }, current);
