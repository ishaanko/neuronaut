import { ConvexError } from "convex/values";

// What to show for a failed call: the backend's own message for a ConvexError, a generic line for anything else.
export function errorText(e: unknown) {
  return e instanceof ConvexError ? String(e.data) : "Something went wrong. Try again.";
}
