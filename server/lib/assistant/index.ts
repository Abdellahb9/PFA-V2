// API publique de l'assistant (agent, outils, instantané). Le reste du serveur
// importe depuis "lib/assistant", jamais depuis un module interne.
export {
  FALLBACK_ANSWER,
  QUOTA_ANSWER,
  runAgent,
  sanitizeHistory,
  unverifiedCitations,
  type AgentEvent,
  type AgentOptions,
  type ChatMessage,
} from "./agent";
export { FINAL_ROUND_INSTRUCTION, SYSTEM, TOOLS } from "./prompt";
export { buildSnapshot, formatSnapshot, rosterLine, ROSTER_LIMIT, STATUS_LABEL } from "./snapshot";
export {
  clampInt,
  optionalNumber,
  resolveCandidate,
  runTool,
  type ToolArgs,
  type ToolContext,
  type ToolResult,
} from "./tools";
