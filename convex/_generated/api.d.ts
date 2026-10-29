/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as admin from "../admin.js";
import type * as bounties from "../bounties.js";
import type * as bountyPool from "../bountyPool.js";
import type * as crons from "../crons.js";
import type * as daily from "../daily.js";
import type * as jobs from "../jobs.js";
import type * as lab from "../lab.js";
import type * as lib from "../lib.js";
import type * as map from "../map.js";
import type * as neurons from "../neurons.js";
import type * as players from "../players.js";
import type * as rules from "../rules.js";
import type * as stats from "../stats.js";
import type * as worker from "../worker.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  admin: typeof admin;
  bounties: typeof bounties;
  bountyPool: typeof bountyPool;
  crons: typeof crons;
  daily: typeof daily;
  jobs: typeof jobs;
  lab: typeof lab;
  lib: typeof lib;
  map: typeof map;
  neurons: typeof neurons;
  players: typeof players;
  rules: typeof rules;
  stats: typeof stats;
  worker: typeof worker;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
