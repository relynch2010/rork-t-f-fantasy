import Foundation

/// One event inside a player's projection. Points always come from the server's scoring engine.
nonisolated struct ProjEvent: Codable, Hashable, Sendable {
    let event: String
    let mark: String?
    let probability: Double
    let points: Double
    let ifCompetes: Double
    let sd: Double
    let status: String
    let actual: Double?
    let tableMissing: Bool
    let samples: Int
    let basis: [ProjBasis]?
    let sources: [ProjSource]?
    let assumptions: [String]?
}

nonisolated struct ProjBasis: Codable, Hashable, Sendable {
    let label: String
    let points: Double
}

nonisolated struct ProjSource: Codable, Hashable, Sendable {
    let date: String
    let meet: String
    let mark: String
}

nonisolated struct PlayerProjection: Codable, Hashable, Sendable {
    let athleteId: String
    let available: Bool
    let confidence: String?
    let projected: Double
    let actual: Double
    let total: Double
    let sd: Double
    let recentAvg: Double?
    let events: [ProjEvent]
    let note: String
    /// projected · actual · finished · notEntered · noMeet · insufficient (older servers omit it).
    let state: String?
    let stateLabel: String?
    /// A strong day; never mixed into projected or actual.
    let upside: Double?
}

nonisolated struct TeamProjection: Codable, Hashable, Sendable {
    let projected: Double
    let actual: Double
    let total: Double
    let sd: Double
    let starters: Int
}

nonisolated struct MatchupProjection: Codable, Hashable, Sendable {
    let id: String
    let homeId: String
    let awayId: String?
    let final: Bool
    let winHome: Double?
    let winAway: Double?
}

nonisolated struct WeekProjections: Codable, Hashable, Sendable {
    let week: Int
    let modelVersion: String
    let computedAt: Double
    let stale: Bool
    let final: Bool
    let athletes: [String: PlayerProjection]
    let teams: [String: TeamProjection]
    let matchups: [MatchupProjection]
}

nonisolated struct AthleteProjectionBody: Codable, Sendable {
    let week: Int
    let modelVersion: String
    let projection: PlayerProjection?
    let stale: Bool
    let computedAt: Double?
    let versions: String?
    let inputsHash: String?
    let note: String?
}

// MARK: - Mock drafts

nonisolated struct MockSeat: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let userId: String?
    let name: String
    let bot: Bool
    /// Draft position this person picked (1-based). nil = random.
    let slot: Int?
}

nonisolated struct MockPick: Codable, Hashable, Sendable {
    let overall: Int
    let round: Int
    let pickInRound: Int
    let seatId: String
    let athleteId: String
    let auto: Bool
    let at: Double
}

nonisolated struct MockDraft: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let kind: String
    let ownerId: String
    let ownerName: String
    let status: String
    let seats: [MockSeat]
    let order: [String]
    let picks: [MockPick]
    let lineups: [String: [String: String?]]
    let pickSeconds: Int
    let deadline: Double?
    let version: Int
    let rounds: Int
    let onClock: String?
    let mySeat: String?

    var totalPicks: Int { order.count * rounds }

    func seatForPick(_ index: Int) -> String? {
        let count = order.count
        guard count > 0, index < totalPicks else { return nil }
        let round = index / count
        let pos = index % count
        return round % 2 == 0 ? order[pos] : order[count - 1 - pos]
    }

    func seat(_ id: String?) -> MockSeat? { seats.first { $0.id == id } }
}

nonisolated struct MockSummary: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let kind: String
    let ownerId: String
    let ownerName: String
    let status: String
    let createdAt: Double
    let seats: Int
    let joined: Int
    let picks: Int
    let mine: Bool
}

nonisolated struct MockBody: Codable, Sendable {
    let mocks: [MockSummary]
    let mock: MockDraft?
    let serverNow: Double
}

nonisolated struct CoInvitePreview: Codable, Hashable, Sendable {
    let leagueId: String
    let leagueName: String
    let teamId: String
    let teamName: String
    let ownerName: String
}
