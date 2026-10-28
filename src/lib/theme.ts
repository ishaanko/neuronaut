// The how-to-play walkthrough opens by itself on a first visit, once.
const SEEN = "neuronaut:seen-howto";
export const firstVisit = () => !localStorage.getItem(SEEN);
export const markSeen = () => localStorage.setItem(SEEN, "1");
