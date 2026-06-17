// TheBigFlex — generic doc→rules→data→outputs engine. Pure core (no app coupling).
export * as operators from "./engine/operators.js";
export { compileRuleBook, defaultNormalizers } from "./engine/rulebook.js";
export { normalizeRow, parseDate, classify } from "./engine/normalize.js";
export { computeRun, runWorkedExamples } from "./engine/compute.js";
export { createFx } from "./engine/fx.js";
export { createEngine } from "./engine/run.js";
