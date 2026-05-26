import { CAUSE_LABELS } from '../constants/rootCauses.js';
import { diffMin } from './dates.js';
import { fmtPct } from './format.js';

// ============================================================
// AI RISK SCORING — heuristic model based on historical patterns
// ============================================================
export const computeRiskScore = (order, allData) => {
  // Only score open orders (not delivered yet)
  if (!order.isOpen) return null;

  let score = 0;
  const reasons = [];

  // 1. Current stage elapsed vs SLA
  const now = new Date();
  const stageElapsed = diffMin(order.orderCreate, now);
  const expectedCycle = 18 * 60; // 18 hrs target order-to-ship
  if (stageElapsed > expectedCycle * 0.8) {
    score += 25;
    reasons.push(`Order aging ${(stageElapsed/60).toFixed(1)}h vs ${expectedCycle/60}h SLA`);
  }

  // 2. Carrier performance last 7 days
  const carrierHistory = allData.filter(d => d.carrier === order.carrier && d.onTimeDelivery !== null);
  const carrierOTD = carrierHistory.length ? carrierHistory.filter(d => d.onTimeDelivery).length / carrierHistory.length : 0.9;
  if (carrierOTD < 0.85) {
    score += 20;
    reasons.push(`${order.carrier} running ${fmtPct(1-carrierOTD)} late recently`);
  }

  // 3. UPS zone difficulty
  if (order.zone >= 7) {
    score += 15;
    reasons.push(`Long-haul Zone ${order.zone} lane (historical risk)`);
  }

  // 4. State-level delay concentration
  const stateHistory = allData.filter(d => d.state === order.state);
  const stateDelayRate = stateHistory.length ? stateHistory.filter(d => d.cause).length / stateHistory.length : 0;
  if (stateDelayRate > 0.35) {
    score += 18;
    reasons.push(`${order.state} has elevated delay rate (${fmtPct(stateDelayRate)})`);
  }

  // 5. SKU pick variance
  const skuHistory = allData.filter(d => d.primarySku === order.primarySku);
  const skuMissingRate = skuHistory.length ? skuHistory.filter(d => d.cause === 'Missing').length / skuHistory.length : 0;
  if (skuMissingRate > 0.15) {
    score += 15;
    reasons.push(`SKU ${order.primarySku} shows pick variance (${fmtPct(skuMissingRate)})`);
  }

  // 6. Already flagged cause
  if (order.cause) {
    score += 30;
    reasons.push(`Active ${CAUSE_LABELS[order.cause]} flag`);
  }

  // 7. Split shipment risk
  if (order.isSplit) {
    score += 12;
    reasons.push(`Order ships split — customer SLA risk`);
  }

  // 8. Fragile + long zone combo
  if (order.skuFragile && order.zone >= 6) {
    score += 8;
    reasons.push(`Fragile SKU on Zone ${order.zone} lane`);
  }

  // 9. High value customer
  if (order.tier === 'Key' && score > 30) {
    reasons.push(`⚡ Key account — escalation priority`);
  }

  // Normalize
  score = Math.min(score, 100);
  const confidence = Math.min(60 + reasons.length * 5, 95);
  const riskLevel = score >= 60 ? 'High' : score >= 30 ? 'Medium' : 'Low';
  const predictedLate = riskLevel !== 'Low';
  const predictedHoursLate = riskLevel === 'High' ? 24 + Math.round(score/3) : riskLevel === 'Medium' ? 8 + Math.round(score/6) : 0;

  return { score, riskLevel, confidence, reasons, predictedLate, predictedHoursLate };
};
