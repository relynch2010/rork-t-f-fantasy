import Foundation

// MARK: - Waiver / free-agent rankings

nonisolated struct RankWeek: Codable, Hashable, Sendable {
    let week: Int
    let points: Double
    let played: Bool
}

nonisolated struct RankRow: Codable, Hashable, Identifiable, Sendable {
    let athleteId: String
    let rank: Int?
    let availability: String
    let ownerId: String?
    let waiverUntil: Double?
    let position: String
    let gender: String
    let projected: Double
    let projectedRemaining: Double
    let actualThisWeek: Double
    let sd: Double
    let confidence: String?
    let projectionAvailable: Bool
    let state: String?
    let stateLabel: String?
    let upside: Double?
    let outlookPerMeet: Double?
    let events: [String]
    let recent: [RankWeek]
    let seasonAvg: Double?
    let seasonTotal: Double
    let lastWeek: Double?
    let trend: Double?
    let consistency: Double?
    let weeksPlayed: Int
    let meetStrength: Double?
    let note: String

    var id: String { athleteId }
}

nonisolated struct ErrStats: Codable, Hashable, Sendable {
    let n: Int
    let mae: Double
    let rmse: Double
    let bias: Double
    let coverage: Double
}

nonisolated struct HeadToHead: Codable, Hashable, Sendable {
    let correct: Int
    let total: Int
    let accuracy: Double?
}

nonisolated struct AccuracySummary: Codable, Hashable, Sendable {
    let at: Double
    let modelVersion: String
    let withEntries: ErrStats?
    let headToHead: HeadToHead?
    let samples: Int?
    let meetsTested: Int?
}

nonisolated struct WaiverRankingsBody: Codable, Sendable {
    let week: Int
    /// Week the projections are for: the next week when the requested one is finished.
    let targetWeek: Int?
    let noMeet: Bool?
    let modelVersion: String
    let computedAt: Double
    let rows: [RankRow]
    let accuracy: AccuracySummary?
    let note: String
}

nonisolated struct ProjectionExplanation: Codable, Hashable, Sendable {
    let text: String
    let facts: [String]
    let source: String
}

nonisolated struct ExplainBody: Codable, Sendable {
    let week: Int
    let modelVersion: String
    let explanation: ProjectionExplanation?
}

// MARK: - Schedule

nonisolated struct SchedTeam: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
}

nonisolated struct SchedGame: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let week: Int
    let homeId: String
    let awayId: String?
    let final: Bool
    let kind: String
    let round: String?
    let locked: Bool?
}

nonisolated struct SchedCheck: Codable, Hashable, Sendable {
    let name: String
    let ok: Bool
    let detail: String
}

nonisolated struct SchedChecks: Codable, Hashable, Sendable {
    let ok: Bool
    let problems: [String]
    let checks: [SchedCheck]
    let byes: [String: Int]
}

nonisolated struct SchedPreview: Codable, Hashable, Sendable {
    let seed: Int?
    let schedule: [SchedGame]
    let checks: SchedChecks
    let changedGames: Int
}

nonisolated struct SchedLog: Codable, Hashable, Sendable {
    let at: Double
    let by: String
    let action: String
    let detail: String
    let fromWeek: Int
}

nonisolated struct ScheduleBody: Codable, Sendable {
    let teams: [SchedTeam]
    let regularWeeks: Int
    let playoffTeams: Int
    let totalWeeks: Int
    let currentWeek: Int
    let firstEditableWeek: Int
    let phase: String
    let advanceAt: Double?
    let timezone: String
    let rhythm: [String]
    let schedule: [SchedGame]
    let checks: SchedChecks
    let preview: SchedPreview?
    let log: [SchedLog]
}

// MARK: - Scoring labs

nonisolated struct LabFormula: Codable, Hashable, Sendable {
    let name: String
    let math: String
    let total: Double?
    let avgSeededMeet: Double?
    let avgUnseededMeet: Double?
    let fairnessViolations: Int?
}

nonisolated struct LabOutcome: Codable, Hashable, Sendable {
    let home: Double
    let away: Double?
    let winner: String
}

/// One played matchup re-scored with every option (keys present depend on the lab).
nonisolated struct LabMatchup: Codable, Hashable, Sendable {
    let label: String
    let home: String
    let away: String
    let current: LabOutcome?
    let neutral: LabOutcome?
    let combined: LabOutcome?
    let strength: LabOutcome?
    let beatSeed: LabOutcome?
    let divided: LabOutcome?
    let full: LabOutcome?

    func outcome(_ key: String) -> LabOutcome? {
        switch key {
        case "current": current
        case "neutral": neutral
        case "combined": combined
        case "strength": strength
        case "beatSeed": beatSeed
        case "divided": divided
        case "full": full
        default: nil
        }
    }
}

nonisolated struct LabAthleteRow: Codable, Hashable, Sendable {
    let athleteId: String
    let name: String
    let date: String?
    let meet: String?
    let seeded: Bool?
    let current: Double?
    let neutral: Double?
    let combined: Double?
    let strength: Double?
    let beatSeed: Double?
    let divided: Double?
    let full: Double?

    func value(_ key: String) -> Double {
        switch key {
        case "neutral": neutral ?? 0
        case "combined": combined ?? 0
        case "strength": strength ?? 0
        case "beatSeed": beatSeed ?? 0
        case "divided": divided ?? 0
        case "full": full ?? 0
        default: current ?? 0
        }
    }
}

nonisolated struct FairSide: Codable, Hashable, Sendable {
    let name: String
    let mark: String
    let place: Int?
    let points: Double
}

nonisolated struct FairExample: Codable, Hashable, Sendable {
    let meet: String
    let date: String
    let event: String
    let unseeded: FairSide
    let seeded: FairSide
}

nonisolated struct SectionStats: Codable, Hashable, Sendable {
    let sectioned: Int
    let reranked: Int
    let noFieldData: Int
    let seededSection: Int
    let unseededSection: Int
}

nonisolated struct LabMeet: Codable, Hashable, Sendable {
    let date: String
    let meet: String
    let results: Int
    let seededSection: Int?
    let unseededSection: Int?
    let seedMarks: Int?
}

nonisolated struct SeedLabBody: Codable, Sendable {
    let ok: Bool
    let message: String?
    let source: String?
    let rulesVersion: String?
    let seasonNote: String?
    let contestsNote: String?
    let note: String?
    let formulas: [String: LabFormula]?
    let sectionStats: SectionStats?
    let fairnessExamples: [FairExample]?
    let fairnessRule: String?
    let meets: [LabMeet]?
    let athletes: [LabAthleteRow]?
    let matchups: [LabMatchup]?
    let matchupFlipsVsCurrent: [String: Int]?
}

nonisolated struct RelayPerLeg: Codable, Hashable, Sendable {
    let current: Double
    let divided: Double
    let full: Double
}

nonisolated struct RelayRow: Codable, Hashable, Sendable {
    let meet: String
    let date: String
    let event: String
    let gender: String
    let place: Int?
    let status: String
    let mark: String
    let legs: [String]
    let verifiedLegs: Int
    let divisor: Int
    let perLeg: RelayPerLeg
}

nonisolated struct LabOption: Codable, Hashable, Sendable {
    let name: String
    let math: String
}

nonisolated struct RelayLabBody: Codable, Sendable {
    let ok: Bool
    let message: String?
    let source: String?
    let contestsNote: String?
    let note: String?
    let options: [String: LabOption]?
    let relays: [RelayRow]?
    let athletes: [LabAthleteRow]?
    let matchups: [LabMatchup]?
    let matchupFlipsVsCurrent: [String: Int]?
    let howItWorks: [String]?
}

nonisolated struct BacktestMeet: Codable, Hashable, Sendable {
    let date: String
    let meet: String
    let athletes: Int
    let mae: Double
    let bias: Double
    let projected: Double
    let actual: Double
}

nonisolated struct BacktestBody: Codable, Sendable {
    let ok: Bool
    let message: String?
    let modelVersion: String?
    let seasonNote: String?
    let meetsTested: Int?
    let samples: Int?
    let withEntries: ErrStats?
    let withoutEntries: ErrStats?
    let naiveLastMeet: ErrStats?
    let byConfidence: [String: ErrStats]?
    let headToHead: HeadToHead?
    let perMeet: [BacktestMeet]?
    let notes: [String]?
}
