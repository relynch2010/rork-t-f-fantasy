import Foundation

// MARK: - Weekly breakdown (every event an athlete competed in, summed)

nonisolated struct BreakdownMark: Codable, Hashable, Sendable {
    let original: String
    let value: Double?
    let unit: String
    let method: String
}

nonisolated struct BreakdownLine: Codable, Hashable, Sendable {
    let code: String
    let category: String?
    let label: String
    let points: Double
    let basis: String?
    let ver: String?
    let season: Int?
}

nonisolated struct ResultVersion: Codable, Hashable, Sendable {
    let at: Double
    let mark: String
    let place: Int?
    let heatPlace: Int?
    let status: String
    let provisional: Bool
}

nonisolated struct BreakdownEvent: Codable, Hashable, Identifiable, Sendable {
    let resultId: String
    let sourceResultId: String?
    let eventId: String?
    let meet: String
    let date: String
    let event: String
    let relay: Bool
    let relayTeam: String?
    let round: String?
    let heat: Int?
    let place: Int?
    let heatPlace: Int?
    let fieldSize: Int?
    let mark: BreakdownMark
    let status: String
    let pbsb: String
    let seedMark: String?
    let provisional: Bool
    let season: Int?
    let corrections: [ResultVersion]?
    let lines: [BreakdownLine]
    let total: Double

    var id: String { resultId }
}

nonisolated struct BreakdownCheck: Codable, Hashable, Sendable {
    let ok: Bool
    let text: String
}

nonisolated struct BreakdownStarter: Codable, Hashable, Sendable {
    let teamId: String
    let teamName: String
    let slot: String?
}

nonisolated struct WeekBreakdown: Codable, Hashable, Sendable {
    let athleteId: String
    let name: String
    let week: Int
    let events: [BreakdownEvent]
    let eventCount: Int
    let sumOfEvents: Double
    let weeklyTotal: Double
    let check: BreakdownCheck
    let starter: BreakdownStarter?
    let matchupContribution: Double
}

nonisolated struct TeamBreakdownEvent: Codable, Hashable, Sendable {
    let event: String
    let meet: String
    let total: Double
    let resultId: String?
}

nonisolated struct TeamBreakdownRow: Codable, Hashable, Sendable {
    let slot: String
    let athleteId: String?
    let name: String?
    let total: Double
    let check: BreakdownCheck?
    let events: [TeamBreakdownEvent]
}

nonisolated struct TeamBreakdown: Codable, Hashable, Sendable {
    let teamId: String
    let teamName: String
    let week: Int
    let starters: [TeamBreakdownRow]
    let bench: [TeamBreakdownRow]
    let starterSum: Double
    let matchupScore: Double
    let final: Bool
    let check: BreakdownCheck
}

// MARK: - Reconcile

nonisolated struct ReconcileIssue: Codable, Hashable, Sendable {
    let kind: String
    let severity: String
    let detail: String
}

nonisolated struct ReconcileMeet: Codable, Hashable, Sendable {
    let meetId: String
    let name: String
    let reread: Bool
    let sourceRows: Int?
    let expected: Int?
    let stored: Int?
    let missing: Int?
    let orphaned: Int?
    let stale: Int?
}

nonisolated struct ReconcileMatchup: Codable, Hashable, Sendable {
    let week: Int
    let teamId: String
    let team: String
    let stored: Double
    let recomputed: Double
    let final: Bool
    let ok: Bool
}

nonisolated struct ReconcileCounts: Codable, Hashable, Sendable {
    let meets: Int
    let results: Int
    let scoringLines: Int
    let playerWeeks: Int
    let multiEventPlayerWeeks: Int
    let matchupSides: Int
    let lineMismatches: Int
    let weeklyMismatches: Int
    let eventSumFailures: Int
    let matchupMismatches: Int
}

nonisolated struct ReconcilePlanted: Codable, Hashable, Sendable {
    let removedResult: String?
    let duplicatedLine: String?
}

nonisolated struct ReconcileReport: Codable, Hashable, Sendable {
    let at: Double
    let ok: Bool
    let mismatches: Int
    let planted: ReconcilePlanted?
    let counts: ReconcileCounts
    let verdict: String
    let meets: [ReconcileMeet]
    let matchups: [ReconcileMatchup]
    let issues: [ReconcileIssue]
}

// MARK: - Health

nonisolated struct HealthAthletes: Codable, Hashable, Sendable {
    let master: Int
    let cornwall: Int
    let needsReview: Int
    let unmatched: Int
    let duplicateCandidates: Int
    let duplicateExamples: [String]
    let sourceConflicts: Int
    let sourceLinks: Int
    let aliases: Int
}

nonisolated struct HealthMeet: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let week: Int
    let status: String
    let live: Bool
    let history: Bool
    let rehearsal: Bool
    let sourceStatus: String
    let lastSuccess: Double?
    let lastAttempt: Double?
    let freshnessMin: Int?
    let events: Int
    let results: Int
    let scored: Int
}

nonisolated struct HealthScoring: Codable, Hashable, Sendable {
    let imported: Int
    let scored: Int
    let historyOnly: Int
    let lines: Int
    let rejected: Int
    let duplicatesBlocked: Int
    let corrections: Int
    let removedByCorrection: Int
    let imports: Int
    let simultaneousImportsSerialized: Int
    let mismatches: Int?
    let lastReconcileAt: Double?
    let versions: String
}

nonisolated struct HealthNotifications: Codable, Hashable, Sendable {
    let queued: Int
    let delivered: Int
    let noDevices: Int
    let failed: Int
    let skipped: Int
    let duplicatesBlocked: Int
    let logged: Int
}

nonisolated struct HealthProjections: Codable, Hashable, Sendable {
    let generated: Int
    let missing: Int
    let stale: Bool
    let errors: Int
    let modelVersion: String?
    let week: Int?
}

nonisolated struct HealthReport: Codable, Hashable, Sendable {
    let at: Double
    let athletes: HealthAthletes
    let meets: [HealthMeet]
    let scoring: HealthScoring
    let notifications: HealthNotifications
    let projections: HealthProjections
}

// MARK: - Notification log

nonisolated struct NoteLogEntry: Codable, Hashable, Identifiable, Sendable {
    let deliveryKey: String
    let noteId: String
    let eventKey: String?
    let category: String
    let title: String
    let recipients: Int
    let createdAt: Double
    let attempts: Int
    let status: String
    let error: String?
    let link: String

    var id: String { deliveryKey }
}

nonisolated struct NoteLogBody: Codable, Sendable {
    let log: [NoteLogEntry]
    let duplicatesBlocked: Int
}

// MARK: - Snapshots

nonisolated struct SnapshotMeta: Codable, Hashable, Identifiable, Sendable {
    let at: Double
    let reason: String
    let results: Int
    let points: Double

    var id: Double { at }
}

nonisolated struct SnapshotsBody: Codable, Sendable {
    let snapshots: [SnapshotMeta]
}

// MARK: - Change preview + versions

nonisolated struct PreviewDiff: Codable, Hashable, Sendable {
    let key: String
    let currentText: String
    let nextText: String
}

nonisolated struct PreviewTier: Codable, Hashable, Sendable {
    let mark: String
    let points: Double
}

nonisolated struct PreviewTable: Codable, Hashable, Sendable {
    let event: String
    let gender: String
    let season: Int
    let current: [PreviewTier]
    let next: [PreviewTier]
}

nonisolated struct PreviewLine: Codable, Hashable, Sendable {
    let event: String
    let meet: String
    let label: String
    let points: Double
}

nonisolated struct PreviewExample: Codable, Hashable, Sendable {
    let athleteId: String
    let name: String
    let week: Int
    let oldScore: Double
    let newScore: Double
    let oldLines: [PreviewLine]
    let newLines: [PreviewLine]
}

nonisolated struct ConfigVersion: Codable, Hashable, Sendable {
    let scoring: Int
    let tables: Int
    let label: String
}

nonisolated struct ChangePreview: Codable, Hashable, Sendable {
    let ok: Bool
    let problems: [String]
    let diff: [PreviewDiff]
    let table: PreviewTable?
    let source: String
    let athletesAffected: Int
    let example: PreviewExample?
    let finishedWeeksProtected: [Int]
    let note: String
    let currentVersion: ConfigVersion
    let canPublish: Bool?
}

nonisolated struct RuleVersionRow: Codable, Hashable, Sendable {
    let version: Int
    let since: Double
    let by: String?
}

nonisolated struct TableVersionRow: Codable, Hashable, Sendable {
    let at: Double
    let version: Int
    let by: String
    let detail: String
}

nonisolated struct VersionAudit: Codable, Hashable, Sendable {
    let at: Double
    let actorName: String
    let action: String
    let detail: String
}

nonisolated struct VersionsBody: Codable, Sendable {
    let current: ConfigVersion?
    let rules: [RuleVersionRow]
    let tables: [TableVersionRow]
    let audit: [VersionAudit]
}

/// Scoring categories the server knows (codes match the server's scoring lines). Point values always come from the server.
enum ScoringCategory {
    static let all: [(code: String, label: String)] = [
        ("part", "Per-event participation"), ("place", "Overall / relay place"), ("heat", "Heat / flight place"),
        ("pct", "Seeded / unseeded percentile"), ("perf", "Time / mark tables"), ("best", "PB / SB (never stacked)"),
        ("std", "Standards (NB / Nike / States)"), ("dq", "DQ / DNF"), ("sr", "School record"), ("fumble", "Baton fumble"),
    ]
    static let appliesOptions: [(code: String, label: String)] = [("individual", "Individual"), ("relay", "Relay"), ("track", "Track"), ("field", "Field")]
}
