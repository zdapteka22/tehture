"use strict";

function easeInOut(t) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

function jitter(n, amount) {
  return n + (Math.random() * 2 - 1) * amount;
}

function mousePath(from, to, steps = 14) {
  const count = Math.max(4, Math.min(40, Math.round(steps)));
  const points = [];
  const midX = (from.x + to.x) / 2 + (to.y - from.y) * 0.08;
  const midY = (from.y + to.y) / 2 + (from.x - to.x) * 0.08;
  for (let i = 1; i <= count; i++) {
    const t = easeInOut(i / count);
    const one = 1 - t;
    points.push({
      x: Math.round(one * one * from.x + 2 * one * t * midX + t * t * to.x),
      y: Math.round(one * one * from.y + 2 * one * t * midY + t * t * to.y),
    });
  }
  return points;
}

function typePlan(text) {
  return [...String(text ?? "")].map((ch) => ({
    ch,
    delay: ch === " " ? 40 : 18 + Math.round(Math.random() * 42),
  }));
}

function clickHoldMs() {
  return 45 + Math.round(Math.random() * 55);
}

function betweenActionMs() {
  return 80 + Math.round(Math.random() * 140);
}

module.exports = {
  easeInOut,
  jitter,
  mousePath,
  typePlan,
  clickHoldMs,
  betweenActionMs,
};
