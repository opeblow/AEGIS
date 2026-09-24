export { default as dealRoutes } from "./deal.routes.js";
export {
  createDeal,
  listDeals,
  getDeal,
  getDealHistory,
  updateDeal,
  transitionDeal,
  expireEligibleDeals,
  REFERENCE_PREFIX,
} from "./deal.service.js";
export {
  DEAL_STATUSES,
  DEAL_TYPES,
  isLegalTransition,
  isTerminalStatus,
  isDeadlineExpirable,
} from "./deal-state.js";
export * from "./deal.types.js";
