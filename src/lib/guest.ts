// This browser's guest token (convex/lib.ts): signed out, the daily is played as the guest it names. Made on first use
// and kept, so a guest's game survives reloads and carries over when they sign up.
export function guestToken() {
  const key = "neuronaut:guest";
  let t = localStorage.getItem(key);
  if (!t) {
    t = crypto.randomUUID();
    localStorage.setItem(key, t);
  }
  return t;
}
