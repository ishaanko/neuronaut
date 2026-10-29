import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("generate dailies ahead", { hours: 1 }, internal.daily.ensure);
crons.interval("count old dailies", { hours: 1 }, internal.daily.countOld);
crons.interval("open bounties", { hours: 1 }, internal.bounties.ensure);
crons.interval("settle bounties", { hours: 1 }, internal.bounties.settle);
export default crons;
