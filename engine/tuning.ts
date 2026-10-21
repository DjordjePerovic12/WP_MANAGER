// Every balance number in the match engine lives here.
// Change these and re-run `npm run batch` to see how the game's statistics move.
// Probabilities are per possession unless stated otherwise.

export const TUNING = {
  quarterSeconds: 8 * 60,
  shotClock: 30,
  exclusionSeconds: 18,       // since the 2025 rules
  brutalityChance: 0.0011,    // per possession: about one brutality every 12 matches (real 2026-27 data)
  brutalitySeconds: 240,      // man down for 4 minutes

  // --- Even-strength possession ---
  possessionMinSeconds: 15,
  possessionMaxSeconds: 28,
  zoneExtraSeconds: 3,        // zone defense makes attacks slower

  exclusionChance: 0.272,     // attacker draws an ordinary exclusion
  penaltyChance: 0.037,
  turnoverChance: 0.16,
  offensiveFoulShare: 0.35,   // share of turnovers that are offensive fouls (mostly at 2m)
  shotClockChance: 0.03,

  // How much the 2m battle (center vs center-defender) changes exclusion odds
  centerBattleWeight: 0.7,
  centerExclusionShare: 0.6,  // share of exclusions drawn at 2m
  twoMeterDefenderShare: 0.5, // share of 2m exclusions committed by the designated center-defender

  // Defensive systems: multipliers on [exclusion, turnover, shot goal %, shot clock]
  defense: {
    press: { exclusion: 1.15, turnover: 1.2, shotGoal: 1.0, shotClock: 0.8 },
    zone: { exclusion: 0.8, turnover: 0.85, shotGoal: 1.0, shotClock: 1.5 },
    mdrop: { exclusion: 0.85, turnover: 0.95, shotGoal: 1.03, shotClock: 1.1 },
  },
  frontCenterExclusion: 0.85,
  frontCenterShotGoal: 1.03,  // fronting leaves outside shooters a bit freer

  // --- Shots ---
  evenShotGoal: 0.45,
  powerPlayShotGoal: 0.5,
  counterShotGoal: 0.6,
  buzzerShotGoal: 0.12,
  penaltyGoal: 0.74,
  /** each point of (shooter quality − goalkeeper quality) adds this to goal chance */
  shooterVsKeeper: 0.015,
  /** of shots that are not goals: share saved, blocked; the rest miss the goal */
  saveShare: 0.56,
  blockShare: 0.15,

  // --- Power play (6 on 5) ---
  powerPlayMinSeconds: 7,
  powerPlayMaxSeconds: 18,
  powerPlayTurnover: 0.4,
  formationFitWeight: 0.012,  // 4-2 rewards shooters, 3-3 rewards passing and the center
  designatedShooters: 2,      // automatic 6v5 shooters when the coach has not named any
  designatedShooterWeight: 2.6, // how much more often the 6v5 ball goes to a designated shooter

  // --- Left-handers on the right side (positions 1 and 2: right wing / right driver) ---
  // A right-hander there has to turn back toward goal; a lefty shoots straight off the pass.
  rightLeftyLineupBonus: 1.0, // rating points a lefty gains when the coach fills a right-side slot
  rightLeftyShotGoal: 0.035,  // added goal chance on a shot by a lefty from the right side
  rightLeftyShooterWeight: 1.25, // a lefty on the right gets more of the shots (×1.5 on the 6v5)
  rightLeftyPowerPlay: 0.04,  // whole 6v5 is harder to defend with a lefty on the right post

  // --- Counterattacks ---
  counterBase: 0.1,
  counterPerAggression: 0.035, // per point above/below 3
  counterAfterSteal: 0.1,
  counterSpeedWeight: 0.012,   // per point of average speed difference
  counterExclusion: 0.28,
  counterPenalty: 0.1,
  counterTurnover: 0.07,

  // Match-day form: each team's goal chance moves by up to ± this (defense counts half)
  matchFormSpread: 0.03,

  // --- Score effects ---
  // Trailing teams push harder and take more risks, leading teams manage the game.
  scoreEffectPerGoal: 0.015,  // goal chance per goal of deficit (− per goal of lead)
  scoreEffectMaxGoals: 4,
  scoreEffectByQuarter: [0.3, 0.6, 0.85, 1],
  leadTempoSeconds: 1,        // 2nd half: possession length change per goal of lead (−1s per goal behind)
  leadTempoMaxGoals: 3,
  holdBallChance: 0.75,       // leading late, the team in possession runs out the clock

  // --- AI coach ---
  coachPressDeficit: [4, 4, 3, 2], // goals behind (by quarter) at which the trailing coach presses
  coachProtectLead: 3,        // Q4 lead at which the coach stops risking counters
  coachLateCheck: 180,        // seconds left in Q4 when the coach looks at the score again
  garbageTimeLead: 6,         // lead in the 2nd half at which the coach empties the bench
  garbageTimeBenchBoost: 1.15,

  // --- Fatigue and substitutions ---
  drainPerSecond: 0.11,
  goalkeeperDrainFactor: 0.3,
  recoverPerSecond: 0.25,
  quarterBreakRecovery: 12,
  fatigueAttributeFloor: 0.72, // a fully exhausted player plays at 72% of their attributes
  // Rolling subs compare how well each player would play right now (rating × fatigue).
  subMargin: 0.06,            // a sub must be this much better than the player in the water
  subMinBenchEnergy: 75,      // a player has to be this rested to come back on
  outOfPositionFactor: 0.9,
  rotationBonus: 0.3,        // extra appeal of a bench player who has barely played (fades as they play)
  rotationTargetSeconds: 240, // …until they have had about 4 minutes
  maxSubsPerStoppage: 2,
  foulTroubleBench: 0.65,     // value of a player on 2 fouls while the team is level or ahead (Q1–Q3)

  maxPersonalFouls: 3,
  foulTroubleCaution: 0.15,   // a player on 2 fouls is this much less likely to commit another
  timeouts: 2,
  timeoutBoost: 0.05,         // goal chance on the set play after a timeout
  // Chance per possession that a coach calls a timeout when…
  timeoutLastChance: 0.9,     // …level or one down in the last 40 seconds
  timeoutLateClose: 0.5,      // …level or up to two down in the last 2:30
  timeoutStopRun: 0.8,        // …the opponent has scored timeoutRun unanswered goals
  timeoutRun: 3,
} as const;
