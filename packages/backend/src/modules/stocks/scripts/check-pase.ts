/**
 * Check mínimo de la fórmula del valor del pase.
 * Correr: pnpm --filter backend check:pase
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { valorPase } from "../services/stock-arb.service.js";

// bid24=1000, tasa=45% TNA, costo=1.15%, 1 día
// valorPase = 1000 - 1000 / (1 + (0.4615/365)*1) = 1.26279...
const pase1 = valorPase(1000, 0.45, 0.0115, 1);
assert.ok(Math.abs(pase1 - 1.26279) < 0.0001, `pase 1 día: ${pase1}`);

// 3 días (viernes): triple de tasa devengada
const pase3 = valorPase(1000, 0.45, 0.0115, 3);
assert.ok(pase3 > pase1 * 2.9 && pase3 < pase1 * 3, `pase 3 días: ${pase3}`);

// Tasa 0 y costo 0 → pase 0 (sin costo de fondeo, cualquier diferencia positiva es ganancia)
assert.equal(valorPase(1000, 0, 0, 1), 0);

// Ganancia: diferencia (bid24 - askCI) menos el pase
const diferencia = 1000 - 990;
assert.ok(Math.abs(diferencia - pase1 - 8.73721) < 0.0001);

console.log("✓ fórmula del valor del pase OK");
