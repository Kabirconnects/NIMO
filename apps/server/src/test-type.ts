import { AgentSettings } from "@workspace/db";
import type { AgentSettingsType } from "@workspace/db";
import type { QueryFilter } from "mongoose";

// Test what the filter type expects
type F = QueryFilter<AgentSettingsType>;
declare const f: F;
// This should work - a proper filter
const validFilter: F = { NIMO_WORKSPACE: "test" };
// This is what we're trying to do
const emptyFilter: F = {}; // This might error
