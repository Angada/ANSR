// The MINT_PARSER flag. Keeps the current single-SOW stub path live until the
// chip path reproduces the worked examples (the trust test). Default: 'stub'.
//   MINT_PARSER=munshi  → calc reads the chip set (Munshi path)
//   MINT_PARSER=stub    → calc reads the static billing_rules box (current path)
// Runtime-overridable (the Admin/UI toggle) without a redeploy; env is the seed.
let _override = null; // null = use env

export function parserMode() {
  if (_override) return _override;
  return (process.env.MINT_PARSER || "stub").toLowerCase() === "munshi" ? "munshi" : "stub";
}

export const useChips = () => parserMode() === "munshi";

export function setParserMode(mode) {
  _override = mode === "munshi" ? "munshi" : mode === "stub" ? "stub" : null;
  return parserMode();
}
