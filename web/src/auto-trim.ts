/**
 * The gentlest E12 trim threshold that makes `evaluate(db)` fit: step from `minimum` towards -10 dB
 * in 1 dB steps, then refine the first fitting interval to 0.1 dB. Returns the -10 dB result when
 * nothing fits.
 */
export function findTrimThreshold<T>(evaluate: (db: number) => T, fits: (value: T) => boolean,
  minimum = -40): { db: number; value: T } {
  let db = minimum;
  let value = evaluate(db);
  while (!fits(value) && db < -10) {
    const previous = db;
    db = Math.min(-10, Number((db + 1).toFixed(1)));
    value = evaluate(db);
    if (fits(value)) {
      for (let tick = Math.round(previous * 10) + 1; tick < Math.round(db * 10); tick++) {
        const candidate = evaluate(tick / 10);
        if (fits(candidate)) return { db: tick / 10, value: candidate };
      }
    }
  }
  return { db, value };
}
