// Calibration weights and signal edges — imported from APEX calibration sweeps
// Two weight sets: DEFAULT (uncalibrated) and CALIBRATED (from APEX's latest sweep)

// Default weights — mirrors APEX DEFAULT_WEIGHTS (pre-calibration baseline)
export const DEFAULT_WEIGHTS = {
    momentumMultiplier: 0.6, rsMultiplier: 0.6, structureMultiplier: 1.25,
    accelBonus: 1.5, consistencyBonus: 1.0,
    sectorInflow: 2.0, sectorModestInflow: 1.0, sectorOutflow: -1.0,
    rsiOversold30: 2.5, rsiOversold40: 1.5, rsiOversold50: 0.5,
    rsiOverbought70: -3.0, rsiOverbought80: -5.0,
    macdBullish: 2.5, macdBearish: -2.0, macdNone: -0.5,
    rsMeanRev95: -6.0, rsMeanRev90: -4.0, rsMeanRev85: -2.0,
    squeezeBonusHigh: 1.5, squeezeBonusMod: 0.75,
    smaProxNear: 2.0, smaProxBelow: 1.0, smaProxFar15: -1.5, smaProxFar10: -0.5,
    smaCrossoverBullish: 2.0, smaCrossoverBearish: -2.0,
    fvgBullish: 0.5, fvgBearish: -0.5,
    entryMultExtreme: 0.3, entryMultExtended: 0.6, entryMultPullback: 1.3
};

// Calibrated weights — from APEX's latest calibration sweep (Mar 3, 2026)
// These are the DEFAULT_WEIGHTS adjusted by calibration correlations
// Update these when APEX runs a new calibration sweep
export const CALIBRATED_WEIGHTS = {
    ...DEFAULT_WEIGHTS,
    // Calibration adjustments (bounded ±50% from defaults with shrinkage)
    // These reflect component correlations with 10d forward returns
    // from 17K+ observations across 13 months (Sept 2024 - Feb 2026)
    momentumMultiplier: 0.45,    // reduced — overweighted per calibration
    rsMultiplier: 0.5,           // reduced — overweighted per calibration
    structureMultiplier: 1.5,    // increased — underweighted per calibration
    accelBonus: 0,               // zeroed — uncorrelated per calibration
    consistencyBonus: 0,         // zeroed — uncorrelated per calibration
    rsiOversold30: 4.0,          // increased — strong positive edge for RSI<30
    rsiOversold40: 2.5,          // increased — positive edge for RSI<40
    rsiOverbought70: -4.5,       // increased penalty
    rsiOverbought80: -7.0,       // increased penalty
};

// Signal calibration edges — from APEX's entry pattern statistics
// winRateEdge = signal win rate minus baseline win rate (percentage points)
// sampleSize = number of observations in calibration data
export const SIGNAL_CALIBRATION_EDGES = {
    REV: { winRateEdge: 0.19, avgReturnEdge: 2.1, sampleSize: 847, calibrationKey: 'rsi_low_structure_bull' },
    MOM: { winRateEdge: -0.03, avgReturnEdge: -0.8, sampleSize: 1205, calibrationKey: 'momentum_trend_confirm' },
    QMO: { winRateEdge: -0.01, avgReturnEdge: -0.3, sampleSize: 432, calibrationKey: 'vol_ratio_low_mom' },
    SQZ: { winRateEdge: 0.02, avgReturnEdge: 0.5, sampleSize: 156, calibrationKey: 'vol_ratio_high_struct' },
    LDR: { winRateEdge: 0.05, avgReturnEdge: 1.2, sampleSize: 623, calibrationKey: 'sector_leader_mom' },
    AVOID: { winRateEdge: -0.22, avgReturnEdge: -4.1, sampleSize: 389, calibrationKey: null },
};

/**
 * Get weight set by name
 * @param {'default'|'calibrated'} name
 * @returns {object} weight set
 */
export function getWeights(name) {
    if (name === 'calibrated') return CALIBRATED_WEIGHTS;
    return DEFAULT_WEIGHTS;
}
