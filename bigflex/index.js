// TheBigFlex — generic doc→rules→data→outputs engine. Pure core (no app coupling).
export * as operators from "./engine/operators.js";
export { compileRuleBook, defaultNormalizers } from "./engine/rulebook.js";
export { normalizeRow, parseDate, classify } from "./engine/normalize.js";
export { computeRun, runWorkedExamples } from "./engine/compute.js";
export { createFx } from "./engine/fx.js";
export { createEngine } from "./engine/run.js";

// Atlas — contract classification + federated normalizer learning (the moat).
export { fingerprint, archetypeSlug, archetypeName, playbook } from "./atlas/fingerprint.js";
export { similarity, rank, decide } from "./atlas/match.js";
export { createFederation } from "./atlas/federation.js";
export { createEpidemiology, suggestFix } from "./atlas/epidemiology.js";
export { createEmbedder } from "./atlas/embed.js";
export { createDrift } from "./atlas/drift.js";
export { createPreIntake } from "./atlas/preintake.js";
