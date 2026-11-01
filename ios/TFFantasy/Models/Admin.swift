import Foundation

/// Commissioner Admin Panel payloads. The server checks access on every request; these only mirror its answers.
nonisolated struct AdminAccess: Codable, Hashable, Sendable {
    let allowed: Bool
    let mode: String?
    let reason: String
    let isMainLeague: Bool
    let leagueName: String
    let limits: String

    var isGlobal: Bool { mode == "global" }
}

nonisolated struct AdminRulesRef: Codable, Hashable, Sendable {
    let rules: GlobalScoringRules
    let version: Int
    let label: String
}

nonisolated struct AdminDraft: Codable, Hashable, Sendable {
    let rules: GlobalScoringRules
    let at: Double
    let by: String
    let baseVersion: Int
}

nonisolated struct AdminDraftBody: Codable, Hashable, Sendable {
    let ok: Bool
    let mode: String
    let draft: AdminDraft?
    let current: AdminRulesRef
}

/// Every write answer: the message shown is always the server's own.
nonisolated struct AdminResult: Codable, Hashable, Sendable {
    let ok: Bool
    let message: String?
    let version: Int?
    let duplicate: Bool?
    let finishedWeeksUnchanged: Bool?
    let finishedWeeks: Int?
}

nonisolated struct AdminPreview: Codable, Hashable, Sendable {
    let ok: Bool
    let problems: [String]?
    let diff: [PreviewDiff]
    let source: String?
    let athletesAffected: Int
    let example: PreviewExample?
    let finishedWeeksProtected: [Int]
    let note: String?
    let unchanged: Bool?
    let finishedWeekChanges: Int?
}

nonisolated struct AdminVersionRow: Codable, Hashable, Sendable, Identifiable {
    let version: Int
    let since: Double
    let by: String?
    let note: String?
    let rules: GlobalScoringRules
    var id: Int { version }
}

nonisolated struct AdminVersions: Codable, Hashable, Sendable {
    let ok: Bool
    let mode: String
    let global: [AdminVersionRow]
    let sandbox: [AdminVersionRow]
    let current: AdminRulesRef
}

nonisolated struct AdminLogEntry: Codable, Hashable, Sendable {
    let at: Double
    let by: String
    let kind: String
    let text: String
    let scope: String
}

nonisolated struct AdminChangelog: Codable, Hashable, Sendable {
    let ok: Bool
    let entries: [AdminLogEntry]
}

nonisolated struct ProjZero: Codable, Hashable, Sendable, Identifiable {
    let athleteId: String
    let name: String
    let team: String?
    let state: String
    let label: String
    let reason: String
    let actual: Double
    let resultsOnFile: Int
    let lastResult: String?
    let pbsOnFile: Int
    let outlookPerMeet: Double?
    let diagnosis: String
    var id: String { athleteId }
}

nonisolated struct ProjHealthBody: Codable, Hashable, Sendable {
    let ok: Bool
    let modelVersion: String
    let currentWeek: Int
    let targetWeek: Int
    let ms: Double
    let athletes: Int
    let currentWeekStates: [String: Int]
    let targetWeekStates: [String: Int]
    let outlookAvailable: Int
    let zeros: [ProjZero]
    let message: String?
    let rules: String
}

nonisolated struct DataMeetCheck: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let date: String
    let week: Int
    let status: String
    let scope: String
    let rehearsal: Bool
    let history: Bool
    let sourceUrl: String?
    let results: Int
    let scored: Int
    let entries: Int
    let ok: Bool
    let problems: [String]
}

nonisolated struct DataReview: Codable, Hashable, Sendable {
    let athletes: Int
    let marks: Int
    let total: Int
}

nonisolated struct DataValidation: Codable, Hashable, Sendable {
    let ok: Bool
    let meets: [DataMeetCheck]
    let results: Int
    let duplicateKeys: Int
    let needsReview: DataReview
    let athleteLinks: Int
    let linkConflicts: Int
    let note: String
}

/// Projection states shared by every screen (never shown as a bare 0.00).
nonisolated enum ProjStateStyle {
    static func short(_ state: String?) -> String? {
        switch state {
        case "finished": return "FINAL"
        case "notEntered": return "NOT ENT"
        case "noMeet": return "NO MEET"
        case "insufficient": return "NO DATA"
        default: return nil
        }
    }

    static func label(_ state: String?) -> String {
        switch state {
        case "projected": return "Projected"
        case "actual": return "Actual"
        case "finished": return "Week finished"
        case "notEntered": return "Not entered"
        case "noMeet": return "No meet scheduled"
        case "insufficient": return "Not enough data"
        default: return state ?? "Unknown"
        }
    }
}

// MARK: - Projection meets (projections only; never scoring)

nonisolated struct ProjMeetStat: Codable, Hashable, Sendable {
    let at: Double
    let results: Int
    let athletes: Int
    let error: String?
    let kept: Bool?
}

nonisolated struct ProjMeetRow: Codable, Hashable, Sendable, Identifiable {
    let id: String
    /// ATHLETICLIVE or TEXT.
    let kind: String
    let name: String
    let date: String
    let url: String?
    let builtin: Bool?
    let by: String?
    let stat: ProjMeetStat?
}

nonisolated struct ProjMeetTotals: Codable, Hashable, Sendable {
    let meets: Int
    let results: Int
    let athletes: Int
}

nonisolated struct ProjMeetsBody: Codable, Hashable, Sendable {
    let ok: Bool
    let mode: String?
    let shared: Bool?
    let scopeNote: String?
    let meets: [ProjMeetRow]
    let builtAt: Double?
    let totals: ProjMeetTotals?
    let message: String?
    let duplicate: Bool?
}

nonisolated struct ProjMeetSample: Codable, Hashable, Sendable, Identifiable {
    let id: String
    let name: String
    let marks: [String]
}

nonisolated struct ProjMeetPreviewBody: Codable, Hashable, Sendable {
    let ok: Bool
    let preview: ProjMeetRow?
    let exists: Bool?
    let rows: Int?
    let events: Int?
    let results: Int?
    let athletes: Int?
    let skipped: Int?
    let sample: [ProjMeetSample]?
    let message: String?
}
