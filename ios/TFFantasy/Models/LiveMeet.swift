import Foundation

nonisolated struct MeetStats: Codable, Hashable, Sendable {
    let processed: Int
    let events: Int
    let eventsFlagged: Int
    let sourceAthletes: Int
    let matched: Int
    let relevant: Int
    let unmatched: Int
    let scored: Int
    let lastChangeAt: Double?
}

/// What the verified AthleticLIVE source says about a meet.
nonisolated struct MeetSourceInfo: Codable, Hashable, Sendable {
    let name: String
    let date: String
    let location: String
    let timer: String
    let url: String
}

nonisolated struct MeetLastTest: Codable, Hashable, Sendable {
    let at: Double
    let ok: Bool
    let message: String
    let results: Int
    let matched: Int
}

/// A configured meet (one per week) whose results the server pulls and scores automatically.
nonisolated struct Meet: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let date: String
    let week: Int
    let provider: String
    let status: String
    let eventsUrl: String
    let rosterUrl: String
    let resultsUrl: String
    let isDemo: Bool?
    let polling: Bool
    let createdAt: Double
    let startedAt: Double?
    let finalAt: Double?
    let lastSyncedAt: Double?
    let lastAttemptAt: Double?
    let nextSyncAt: Double?
    let syncCount: Int
    let sourceError: String?
    let sourceErrorAt: Double?
    let failures: Int
    let stats: MeetStats
    let sourceUrl: String?
    /// Verified AthleticLIVE meet number behind the pasted link.
    let sourceMeetId: String?
    let sourceInfo: MeetSourceInfo?
    let resolve: MeetResolve?
    let schedule: [MeetEventSlot]?
    let tablesMissing: [String]?
    /// "global" = a Main League meet shared by every league.
    let scope: String?
    /// Old league-only meet: its points are kept but it no longer runs.
    let archived: Bool?
    let lastTest: MeetLastTest?

    var isGlobal: Bool { scope == "global" }
    var isArchived: Bool { archived ?? false }
    var isLive: Bool { status == "LIVE" }
    var isFinal: Bool { status == "FINAL" }

    var providerLabel: String {
        switch provider {
        case "MANUAL": return "Pasted feed"
        default: return "AthleticLIVE"
        }
    }
}

nonisolated struct MeetResolve: Codable, Hashable, Sendable {
    let ok: Bool
    let kind: String
    let message: String
    let at: Double
}

nonisolated struct MeetEventSlot: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let name: String
    let event: String?
    let gender: String?
    let startAt: Double?
}

nonisolated struct AdpEntry: Codable, Hashable, Sendable {
    let name: String
    let athleteId: String?
    let match: String
    let candidates: [String]

    var needsReview: Bool { match == "none" || match == "fuzzy" }
}

nonisolated struct UnmatchedItem: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let meetId: String
    let kind: String
    let sourceName: String
    let school: String
    let gender: String
    let bib: String
    let eventName: String
    let result: String
    let candidates: [String]
    let relevant: Bool
    let status: String
    let createdAt: Double
}

nonisolated struct AuditEntry: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let at: Double
    let actorId: String
    let actorName: String
    let action: String
    let detail: String
}

nonisolated struct ScoringStandard: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let season: Int
    let gender: Gender
    let event: String
    let type: String
    let mark: String
    let points: Int
    let active: Bool
}

nonisolated struct HistoryEntry: Codable, Hashable, Sendable {
    let date: String
    let meet: String
    let mark: String
    let place: Int?
    let pb: Bool
    let sb: Bool
}

nonisolated struct EventHistory: Codable, Hashable, Sendable {
    let event: String
    let lifetimePb: String?
    let seasonBest: String?
    let results: [HistoryEntry]
}

nonisolated struct MeetTestEvent: Codable, Hashable, Sendable {
    let name: String
    let event: String?
    let rows: Int
    let complete: Bool
    let gender: String?
    let kind: String?
    let round: String?
    let heats: Int?
    let fieldSize: Int?
    let cornwall: Int?
    let sourceFinal: Bool?
}

/// One step of finding the meet's data (link → meet record → events → results).
nonisolated struct LabStep: Codable, Hashable, Sendable {
    let name: String
    let url: String
    let ok: Bool
    let note: String
}

nonisolated struct LabCheck: Codable, Hashable, Sendable {
    let name: String
    let ok: Bool
    let detail: String
}

nonisolated struct LabSource: Codable, Hashable, Sendable {
    let publicUrl: String?
    let resolvedUrl: String?
    let meetId: String?
    let name: String?
    let date: String?
    let location: String?
    let region: String?
    let timer: String?
    let sourceType: String?
}

nonisolated struct LabCounts: Codable, Hashable, Sendable {
    let events: Int?
    let athletes: Int?
    let results: Int?
    let cornwall: Int?
    let matched: Int?
    let review: Int?
    let conflicts: Int?
    let unmatched: Int?
    let rejected: Int?
    let missingEvents: Int?
    let duplicatesPrevented: Int?
    let scoringLines: Int?
    let points: Double?
}

nonisolated struct LabCapabilities: Codable, Hashable, Sendable {
    let events: Int?
    let eventsWithResults: Int?
    let relayEvents: Int?
    let fieldEvents: Int?
    let runningEvents: Int?
    let resultRows: Int?
    let athletes: Int?
    let teams: Int?
    let heats: Bool?
    let flights: Bool?
    let overallPlaces: Bool?
    let heatPlaces: Bool?
    let seeds: Bool?
    let wind: Bool?
    let pbSb: Bool?
    let fieldAttempts: Bool?
    let relayLegs: Bool?
    let athleteIds: Bool?
    let schools: Bool?
    let schedule: Bool?
}

nonisolated struct LabNamed: Codable, Hashable, Sendable {
    let id: String
    let name: String
}

nonisolated struct LabSourceAthlete: Codable, Hashable, Sendable {
    let sourceId: String?
    let name: String
    let school: String?
    let gender: String?
    let grade: String?
    let bib: String?
    let teamId: String?
    let members: [String]?
}

nonisolated struct LabMaster: Codable, Hashable, Sendable {
    let id: String
    let name: String
    let school: String?
    let positions: [String]?
}

nonisolated struct LabMatch: Codable, Hashable, Sendable {
    let type: String
    let confidence: String
    let reason: String
    let candidates: [LabNamed]?
}

nonisolated struct LabResult: Codable, Hashable, Sendable {
    let meet: String?
    let sourceEvent: String
    let event: String?
    let gender: String?
    let type: String?
    let round: String?
    let heat: Int?
    let heats: Int?
    let heatPlace: Int?
    let place: Int?
    let mark: String
    let status: String
    let fieldSize: Int?
    let eventFieldSize: Int?
    let seedMark: String?
    let wind: String?
    let sourcePb: String?
    let sourceSb: String?
    let completeness: String?
    let sourceFinal: Bool?
    let best: String?
    let provisional: Bool?
    let historyOnly: Bool?
}

nonisolated struct LabLine: Codable, Hashable, Sendable {
    let code: String
    let label: String
    let points: Double
    /// Exact evidence: matched table + threshold, percentile math, etc.
    let basis: String?
    let ver: String?
}

nonisolated struct LabScoring: Codable, Hashable, Sendable {
    let scoringVersion: Int?
    let lines: [LabLine]
    let total: Double
    let resultId: String?
}

nonisolated struct LabRelayMember: Codable, Hashable, Sendable {
    let id: String
    let name: String
    let lines: [LabLine]?
    let total: Double?
}

/// Source → master player → result → fantasy points, for one athlete result.
nonisolated struct LabEvidence: Codable, Hashable, Sendable {
    let kind: String
    let source: LabSourceAthlete
    let master: LabMaster?
    let relayMembers: [LabRelayMember]?
    let match: LabMatch
    let result: LabResult
    let scoring: LabScoring
    let rawText: String?
}

nonisolated struct LabVerdict: Codable, Hashable, Sendable {
    let verdict: String?
    let message: String?
    let outcome: String?
    let identical: Bool?
}

nonisolated struct LabIsolation: Codable, Hashable, Sendable {
    let unchanged: Bool
}

/// Test Connection and Meet Test Lab result (same production pipeline; the Lab adds evidence and acceptance checks).
nonisolated struct MeetTestResult: Codable, Hashable, Sendable {
    let ok: Bool
    let error: String?
    let format: String?
    let results: Int?
    let events: [MeetTestEvent]?
    let feedEvents: Int?
    let sourceAthletes: Int?
    let matched: Int?
    let relevant: Int?
    let needsReview: Int?
    let unknownEvents: [String]?
    let relevantNames: [String]?
    let message: String?
    let status: String?
    let temporary: Bool?
    let hint: String?
    let problem: String?
    let source: LabSource?
    let steps: [LabStep]?
    let checks: [LabCheck]?
    let warnings: [String]?
    let counts: LabCounts?
    let capabilities: LabCapabilities?
    let evidence: [LabEvidence]?
    let `repeat`: LabVerdict?
    let reconcile: LabVerdict?
    let fault: LabVerdict?
    let isolation: LabIsolation?

    /// PASS / WARNINGS / FAIL (older servers only report ok).
    var verdict: String { status ?? (ok ? "PASS" : "FAIL") }
}

nonisolated struct MatchupLinesBody: Codable, Sendable {
    let week: Int
    let teamIds: [String]
    let athleteIds: [String]
    let lines: [ScoreLine]
}

nonisolated struct SocketMessage: Decodable, Sendable {
    let type: String
    let version: Int?
}
