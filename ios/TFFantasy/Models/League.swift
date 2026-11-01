import Foundation

nonisolated enum Gender: String, Codable, Hashable, CaseIterable, Sendable {
    case B, G

    var label: String { self == .B ? "Boys" : "Girls" }
}

nonisolated enum Pos: String, Codable, Hashable, CaseIterable, Sendable {
    case SPR, DIS, FLD

    var label: String {
        switch self {
        case .SPR: return "Sprinter"
        case .DIS: return "Distance"
        case .FLD: return "Field"
        }
    }
}

nonisolated struct Athlete: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let gender: Gender
    let positions: [Pos]
    let flex: Bool
    let note: String
    let rank: Int
    let school: String?
    let status: String?
    /// League-scoped headshot path (versioned), set only by the commissioner. nil = initials badge.
    let photo: String?
    /// Version of the headshot (ms). Sent back on edits so a stale phone can't overwrite a newer photo.
    let photoAt: Double?

    var playerStatus: PlayerStatus { PlayerStatus(rawValue: status ?? "active") ?? .active }

    /// Structured position code: "SPR", "SPR/DIS", "SPR/FLD", "DIS", "DIS/FLD", "FLD" or "FLEX".
    var posCode: String { flex ? "FLEX" : Pos.allCases.filter { positions.contains($0) }.map(\.rawValue).joined(separator: "/") }

    var firstName: String { name.split(separator: " ").first.map(String.init) ?? name }

    /// Yahoo-style "A. FITZHARRIS".
    var shortName: String {
        let parts = name.split(separator: " ")
        guard parts.count > 1, let first = parts.first?.first else { return name.uppercased() }
        return "\(first). \(parts.dropFirst().joined(separator: " "))".uppercased()
    }

    var initials: String {
        let parts = name.split(separator: " ")
        let letters = [parts.first?.first, parts.dropFirst().last?.first].compactMap { $0 }
        return letters.map { String($0).uppercased() }.joined()
    }

    var posShort: String { posCode }
    var posLabel: String { flex ? "Flex" : Pos.allCases.filter { positions.contains($0) }.map(\.label).joined(separator: "/") }
}

/// Commissioner-set availability. Only IR and Out may sit in the IR spot.
nonisolated enum PlayerStatus: String, CaseIterable, Identifiable, Hashable, Sendable {
    case active, Q, O, IR

    var id: String { rawValue }
    var tag: String? { self == .active ? nil : rawValue }
    var label: String {
        switch self {
        case .active: return "Active"
        case .Q: return "Questionable"
        case .O: return "Out"
        case .IR: return "IR"
        }
    }
    var canUseIR: Bool { self == .O || self == .IR }
}

nonisolated enum Slot: String, CaseIterable, Identifiable, Hashable, Sendable {
    case SPR, DIS, FLD, FLEX, BN1, BN2, IR

    var id: String { rawValue }

    var short: String {
        switch self {
        case .BN1, .BN2: return "BN"
        default: return rawValue
        }
    }

    var label: String {
        switch self {
        case .SPR: return "Sprinter"
        case .DIS: return "Distance"
        case .FLD: return "Field"
        case .FLEX: return "Flex"
        case .BN1, .BN2: return "Bench"
        case .IR: return "IR"
        }
    }

    var pos: Pos? {
        switch self {
        case .SPR: return .SPR
        case .DIS: return .DIS
        case .FLD: return .FLD
        default: return nil
        }
    }

    var isStarter: Bool { Slot.starters.contains(self) }

    func accepts(_ athlete: Athlete) -> Bool {
        if self == .IR { return athlete.playerStatus.canUseIR }
        guard let pos else { return true }
        return athlete.positions.contains(pos)
    }

    static let starters: [Slot] = [.SPR, .DIS, .FLD, .FLEX]
    static let bench: [Slot] = [.BN1, .BN2]
}

nonisolated struct Team: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let ownerName: String
    let teamName: String
    let color: String
    let lineup: [String: String?]
    let roster: [String]
    let queue: [String]
    let waiverPriority: Int
    let faab: Int
    let addsThisWeek: Int
    let joinedAt: Double
    let wins: Int
    let losses: Int
    let ties: Int
    let pointsFor: Double
    let pointsAgainst: Double
    let streak: String
    let rank: Int
    let avatarAt: Double?
    /// One optional co-manager. Both managers have the same team permissions (server-enforced).
    let coManagerId: String?
    let coManagerName: String?
    /// Open co-manager invite code (only sent to the team's primary manager).
    let coInvite: CoInvite?

    var initials: String {
        let words = teamName.split(separator: " ").filter { $0.first?.isLetter == true || $0.first?.isNumber == true }
        let letters = words.prefix(2).compactMap { $0.first }.map { String($0).uppercased() }
        return letters.isEmpty ? "TD" : letters.joined()
    }

    var record: String { "\(wins)-\(losses)-\(ties)" }

    func athlete(in slot: Slot) -> String? { lineup[slot.rawValue] ?? nil }
}

nonisolated struct CoInvite: Codable, Hashable, Sendable {
    let code: String
    let at: Double
}

/// A player locked into the spot they held when their first event of the week started (server-written).
nonisolated struct PlayerLock: Codable, Hashable, Sendable {
    let at: Double
    let event: String
    let meetId: String
    let teamId: String?
    let slot: String?
    let reason: String
}

nonisolated struct DraftPick: Codable, Hashable, Sendable {
    let overall: Int
    let round: Int
    let pickInRound: Int
    let teamId: String
    let athleteId: String
    let auto: Bool
    let at: Double
}

nonisolated struct DraftInfo: Codable, Hashable, Sendable {
    let order: [String]
    let picks: [DraftPick]
    let status: String
    let deadline: Double?
    let pausedRemaining: Double?
    let startedAt: Double?
    let rounds: Int
}

nonisolated struct Matchup: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let week: Int
    let homeId: String
    let awayId: String?
    let final: Bool
    let kind: String
    let round: String?
    let homeScore: Double
    let awayScore: Double?

    func opponent(of teamId: String) -> String? { teamId == homeId ? awayId : homeId }
    func involves(_ teamId: String) -> Bool { homeId == teamId || awayId == teamId }
    func score(of teamId: String) -> Double { teamId == homeId ? homeScore : (awayScore ?? 0) }
}

nonisolated struct BracketGame: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let top: String?
    let bottom: String?
    let topSeed: Int?
    let bottomSeed: Int?
    let winnerId: String?
}

nonisolated struct BracketRound: Codable, Hashable, Sendable {
    let week: Int
    let name: String
    let games: [BracketGame]
}

nonisolated struct Bracket: Codable, Hashable, Sendable {
    let size: Int
    let teams: Int
    let seeded: Bool
    let seeds: [String]
    let rounds: [BracketRound]
    let championId: String?
}

nonisolated struct Trade: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let fromId: String
    let toId: String
    let give: [String]
    let get: [String]
    let message: String
    let status: String
    let createdAt: Double
    let resolvedAt: Double?
    let reviewUntil: Double?
    let vetoes: [String]
    let counterOf: String?
}

nonisolated struct WaiverClaim: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let teamId: String
    let addId: String
    let dropId: String?
    let bid: Int
    let createdAt: Double
    let status: String
    let resolvedAt: Double?
    let reason: String
    /// This team's own order for its claims (1 = tried first).
    let rank: Int?
}

nonisolated struct LeagueTx: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let kind: String
    let teamId: String?
    let text: String
    let at: Double
    let athleteIds: [String]
    let otherId: String?
    let status: String?
    /// Server-computed: this viewer's team made (or was the other side of) the move.
    let mine: Bool?
}

nonisolated struct NoteLink: Codable, Hashable, Sendable {
    let type: String
    let id: String?
    let week: Int?
}

nonisolated struct LeagueNote: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let at: Double
    let title: String
    let body: String
    let kind: String
    let category: String?
    let link: NoteLink?
    let read: Bool?

    var isRead: Bool { read ?? false }
}

nonisolated struct LeagueSettings: Codable, Hashable, Sendable {
    let maxTeams: Int
    let draftAt: Double?
    let draftOrderMode: String
    let pickSeconds: Int
    let regularWeeks: Int
    let playoffTeams: Int
    let consolation: Bool
    let tiebreaker: String
    let waiverType: String
    let waiverSchedule: String?
    let waiverDay: Int?
    let waiverDays: Int
    let waiverHour: Int
    let tzOffsetMin: Int
    let faabBudget: Int
    let maxAddsPerWeek: Int
    let tradeReview: String
    let tradeReviewDays: Int
    let vetoVotes: Int
    let tradeDeadlineWeek: Int
    let lineupLock: String

    var isFAAB: Bool { waiverType == "faab" }
    var isWeeklyWaivers: Bool { (waiverSchedule ?? "weekly") != "daily" }
    /// e.g. "Wednesday at 3:00 AM ET".
    var waiverScheduleLabel: String {
        let h = waiverHour % 12 == 0 ? 12 : waiverHour % 12
        let time = "\(h):00 \(waiverHour < 12 ? "AM" : "PM") ET"
        guard isWeeklyWaivers else { return "\(waiverDays) day\(waiverDays == 1 ? "" : "s"), then \(time)" }
        return "\(WeekdayName.full(waiverDay ?? 3)) at \(time)"
    }
}

nonisolated enum WeekdayName {
    static let all: [String] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
    static func full(_ day: Int) -> String { all[max(0, min(6, day))] }
}

nonisolated struct LeagueSummary: Codable, Hashable, Identifiable, Sendable {
    let leagueId: String
    let code: String
    let name: String
    /// Hidden from Home for this account only (server-saved).
    let hidden: Bool?
    /// The one Main League (code T7RAN2) whose rules and meets apply to every league.
    let isMainLeague: Bool?

    var id: String { leagueId }
    var isHidden: Bool { hidden ?? false }
    var isMain: Bool { isMainLeague ?? false }
}

/// Point values for every scoring category (global, set by the Main League).
nonisolated struct GlobalScoringRules: Codable, Hashable, Sendable {
    var participation: Double
    var overall: [Double]
    var relay: [Double]
    var pb: Double
    var sb: Double
    var bestMode: String
    var heat: [Double]
    var percentile: [PercentileTier]
    /// Unseeded-section brackets (ranked within the unseeded section). nil = older rules without them.
    var percentileUnseeded: [PercentileTier]?
    var standardCap: Double
    var schoolRecord: Double
    var fumble: Double
    var dqdnf: Double
    /// Category on/off (missing = on).
    var enabled: [String: Bool]?
    /// Which result kinds a category applies to (missing = all).
    var applies: [String: [String]]?
}

nonisolated struct PercentileTier: Codable, Hashable, Sendable {
    var pct: Double
    var pts: Double
}

/// Game rules shared by every league (league size, draft time and draft order stay per league).
nonisolated struct GlobalGameSettings: Codable, Hashable, Sendable {
    var pickSeconds: Int
    var regularWeeks: Int
    var playoffTeams: Int
    var consolation: Bool
    var tiebreaker: String
    var waiverType: String
    var waiverSchedule: String?
    var waiverDay: Int?
    var waiverDays: Int
    var waiverHour: Int
    var tzOffsetMin: Int
    var faabBudget: Int
    var maxAddsPerWeek: Int
    var tradeReview: String
    var tradeReviewDays: Int
    var vetoVotes: Int
    var tradeDeadlineWeek: Int
    var lineupLock: String
}

nonisolated struct RosterRules: Codable, Hashable, Sendable {
    var irSlot: Bool
    var irStatuses: [String]
    var flexPositions: [String]
}

nonisolated struct LiveRules: Codable, Hashable, Sendable {
    var pollSeconds: Int
    var autoFinalMinutes: Int
    var maxLiveHours: Int
}

nonisolated struct NoticeRules: Codable, Hashable, Sendable {
    var player: Bool
    var trades: Bool
    var waivers: Bool
    var draft: Bool
    var live: Bool
    var league: Bool
}

/// The Main League's global setup, as every league sees it.
nonisolated struct GlobalSetup: Codable, Hashable, Sendable {
    let version: Int
    let scoringVersion: Int
    let updatedAt: Double
    let updatedBy: String
    let rules: GlobalScoringRules
    let settings: GlobalGameSettings?
    let roster: RosterRules
    let live: LiveRules
    let notices: NoticeRules
}

nonisolated struct GlobalLeagueRow: Codable, Hashable, Identifiable, Sendable {
    let leagueId: String
    let name: String
    let code: String
    let isMainLeague: Bool
    let version: Int
    let upToDate: Bool
    let phase: String
    let shapePending: Bool
    let syncedAt: Double?
    var id: String { leagueId }
}

nonisolated struct GlobalLeaguesBody: Codable, Sendable {
    let version: Int
    let leagues: [GlobalLeagueRow]
}

nonisolated enum LeaguePhase: String, Sendable {
    case predraft, drafting, season, complete
}

nonisolated struct LeagueState: Codable, Hashable, Sendable {
    let id: String
    let name: String
    let code: String
    let commissionerId: String
    let createdAt: Double
    let season: Int
    let phase: String
    let settings: LeagueSettings
    let week: Int
    let version: Int
    let teams: [Team]
    let standings: [String]
    let athletes: [Athlete]
    let draft: DraftInfo
    let schedule: [Matchup]
    let bracket: Bracket?
    let points: [String: [String: Double]]
    let lineupSnapshots: [String: [String: [String: String?]]]
    let waivers: [String: Double]
    let claims: [WaiverClaim]
    let trades: [Trade]
    let transactions: [LeagueTx]
    let notifications: [LeagueNote]
    let totalWeeks: Int
    let me: String
    let serverNow: Double
    let meets: [Meet]?
    let adp: [String]?
    let adpReview: [AdpEntry]?
    let unmatched: [UnmatchedItem]?
    let unmatchedCount: Int?
    let audit: [AuditEntry]?
    let rankings: [String]?
    let lastCompletedWeek: Int?
    let lastWeekPoints: [String: Double]?
    let waiverOrder: [String]?
    /// The signed-in account (differs from `me` for a co-manager, where `me` is the team they manage).
    let viewerId: String?
    /// "primary" or "co".
    let role: String?
    /// Current week's per-player locks: athleteId → lock.
    let locks: [String: PlayerLock]?
    /// This league is the Main League (its commissioner controls the global setup).
    let isMainLeague: Bool?
    /// The viewer may change global settings (Main League commissioner only; enforced by the server).
    let canEditGlobal: Bool?
    /// Global season-shape changes wait until this league's next draft.
    let shapePending: Bool?
    let global: GlobalSetup?
    let globalVersion: Int?
    /// Next scheduled waiver run (ms). Claims are due before this.
    let nextWaiverRun: Double?
    /// Viewer may edit master player info (Main League commissioner only; enforced by the server).
    let canEditPlayers: Bool?
    /// Team ids in waiver priority order (1st = claims first).
    let waiverPriorityOrder: [String]?
    /// The finished week stays on screen until this time (next Monday 12:00 AM ET), then the next matchup activates.
    let nextWeekAt: Double?
    /// athleteId → open "possible match" results waiting for commissioner review (the "?" indicator).
    let reviewFlags: [String: Int]?

    var isMain: Bool { isMainLeague ?? false }
    var canEditGlobalSettings: Bool { canEditGlobal ?? false }
}

// MARK: - Scoring engine payloads

nonisolated struct ScoreLine: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let athleteId: String
    let week: Int
    let sourceId: String
    let meet: String
    let date: String
    let event: String
    let code: String
    let label: String
    let points: Double
    let detail: String?
    let provisional: Bool?
    let meetId: String?
}

nonisolated struct AthleteLinesBody: Codable, Sendable {
    let athleteId: String
    let lines: [ScoreLine]
}

nonisolated struct ResultPreview: Codable, Hashable, Sendable {
    let lines: [ScoreLine]
    let total: Double
}

nonisolated struct ResultRecord: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let key: String
    let week: Int
    let meet: String
    let date: String
    let event: String
    let gender: Gender
    let athleteIds: [String]
    let relay: Bool
    let mark: String
    let place: Int?
    let heatPlace: Int?
    let seeded: Int?
    let status: String
    let best: String
    let enteredAt: Double
    let source: String
    let meetId: String?
    let provisional: Bool?
    let locked: Bool?
    let detail: String?
    let historyOnly: Bool?

    var isLive: Bool { source == "live" }
}

nonisolated struct SchoolRecordItem: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let athleteId: String
    let school: String
    let event: String
    let date: String
    let mark: String
    let season: Int
    let week: Int
}

nonisolated struct FumbleItem: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let athleteId: String
    let teamId: String?
    let meet: String
    let event: String
    let date: String
    let week: Int
}

nonisolated struct ScoringData: Codable, Hashable, Sendable {
    let results: [ResultRecord]
    let records: [SchoolRecordItem]
    let fumbles: [FumbleItem]
    let standards: [ScoringStandard]
    let pbs: [String: [String: String]]
    let events: [String]
    let history: [String: [String: EventHistory]]?
    let performance: [PerformanceTier]?
    let performanceEvents: [PerformanceEvent]?
    let heatRuleFromWeek: Int?
}

/// One tier of a Fantasy T&F time/mark performance table (server-configured; the app never computes points).
nonisolated struct PerformanceTier: Codable, Hashable, Identifiable, Sendable {
    let id: String
    let season: Int
    let gender: String
    let event: String
    let measurement: String
    let mark: String
    let value: Double
    let points: Double
    let active: Bool
    let fromWeek: Int?
    let toWeek: Int?

    var isCurrent: Bool { toWeek == nil }
}

nonisolated struct PerformanceEvent: Codable, Hashable, Sendable {
    let event: String
    let measurement: String?
}

nonisolated enum Availability: Hashable, Sendable {
    case owned(String)
    case waivers(Double)
    case freeAgent
}

// MARK: - Derived league helpers

extension LeagueState {
    var phaseKind: LeaguePhase { LeaguePhase(rawValue: phase) ?? .predraft }
    var myTeam: Team? { teams.first { $0.id == me } }
    var isCommissioner: Bool { commissionerId == (viewerId ?? me) }
    var isCoManager: Bool { role == "co" }

    func lock(for athleteId: String?) -> PlayerLock? {
        guard let athleteId, phaseKind == .season else { return nil }
        return locks?[athleteId]
    }
    var isInSeason: Bool { phaseKind == .season }

    func team(_ id: String?) -> Team? {
        guard let id else { return nil }
        return teams.first { $0.id == id }
    }

    var standingsTeams: [Team] { standings.compactMap { team($0) } }

    /// athleteId → 1-based season rank (server-computed, same tie-break for everyone).
    var rankMap: [String: Int] {
        Dictionary((rankings ?? []).enumerated().map { ($1, $0 + 1) }, uniquingKeysWith: { a, _ in a })
    }

    /// athleteId → position in the waiver-wire order (last completed week's final points, then draft rank).
    var waiverRankMap: [String: Int] {
        Dictionary((waiverOrder ?? []).enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
    }

    var unreadCount: Int { notifications.filter { !$0.isRead }.count }

    /// True when the team has an empty spot this athlete can go in (IR only takes IR/Out players).
    func hasOpenSpot(for athlete: Athlete, team: Team) -> Bool {
        if Slot.allCases.contains(where: { $0 != .IR && team.athlete(in: $0) == nil }) { return true }
        return team.athlete(in: .IR) == nil && athlete.playerStatus.canUseIR
    }

    /// An athlete sitting in my IR spot who is no longer IR/Out — blocks adds and claims until moved.
    func irProblem(for teamId: String, athletes: [String: Athlete]) -> Athlete? {
        guard let id = team(teamId)?.athlete(in: .IR), let a = athletes[id] else { return nil }
        return a.playerStatus.canUseIR ? nil : a
    }

    // Live meets

    var allMeets: [Meet] { meets ?? [] }

    /// The meet that drives a week's live status: a live one first, otherwise the latest for that week.
    func meet(forWeek week: Int) -> Meet? {
        let list = allMeets.filter { $0.week == week && !($0.isDemo ?? false) }
        return list.first { $0.status == "LIVE" } ?? list.max { ($0.lastSyncedAt ?? $0.createdAt) < ($1.lastSyncedAt ?? $1.createdAt) }
    }

    var liveMeetCount: Int { allMeets.filter { $0.status == "LIVE" && $0.polling }.count }

    /// athleteId → 0-based draft ranking position (ADP list first, then pool order).
    var adpRankMap: [String: Int] {
        Dictionary((adp ?? []).enumerated().map { ($1, $0) }, uniquingKeysWith: { a, _ in a })
    }

    var playoffCutoff: Int {
        if let bracket { return bracket.teams }
        return [8, 6, 4, 2].first { $0 <= settings.playoffTeams && $0 <= teams.count } ?? 0
    }

    // Draft

    var totalPicks: Int { draft.order.count * draft.rounds }

    /// Snake order: even rounds forward, odd rounds reversed. `index` is 0-based.
    func teamForPick(_ index: Int) -> String? {
        let count = draft.order.count
        guard count > 0, index < totalPicks else { return nil }
        let round = index / count
        let position = index % count
        return round % 2 == 0 ? draft.order[position] : draft.order[count - 1 - position]
    }

    var teamOnClock: String? {
        guard phaseKind == .drafting else { return nil }
        return teamForPick(draft.picks.count)
    }

    func nextPickIndex(for teamId: String) -> Int? {
        guard totalPicks > 0 else { return nil }
        return (draft.picks.count..<totalPicks).first { teamForPick($0) == teamId }
    }

    // Weeks

    var displayWeek: Int { max(1, min(week, max(totalWeeks, 1))) }

    func matchup(for teamId: String, week: Int) -> Matchup? {
        schedule.first { $0.week == week && $0.involves(teamId) }
    }

    func matchups(week: Int) -> [Matchup] { schedule.filter { $0.week == week } }

    func isWeekLocked(_ week: Int) -> Bool {
        lineupSnapshots["\(week)"] != nil || week < self.week || phaseKind == .complete
    }

    var isLineupLocked: Bool { isWeekLocked(week) }

    func weekLabel(_ week: Int) -> String {
        if let round = schedule.first(where: { $0.week == week && $0.kind != "regular" })?.round, week > settings.regularWeeks {
            return round
        }
        if week > settings.regularWeeks, let name = bracket?.rounds.first(where: { $0.week == week })?.name { return name }
        return "Week \(week)"
    }

    // Lineups & points

    func lineup(for teamId: String, week: Int) -> [String: String?] {
        if let snap = lineupSnapshots["\(week)"]?[teamId] { return snap }
        if week >= self.week { return team(teamId)?.lineup ?? [:] }
        return [:]
    }

    func athleteId(teamId: String, week: Int, slot: Slot) -> String? {
        lineup(for: teamId, week: week)[slot.rawValue] ?? nil
    }

    func points(_ athleteId: String, week: Int) -> Double { points[athleteId]?["\(week)"] ?? 0 }

    func seasonPoints(_ athleteId: String) -> Double {
        points[athleteId]?.values.reduce(0, +) ?? 0
    }

    func weekScore(_ teamId: String, week: Int) -> Double {
        let total = Slot.starters.reduce(0.0) { sum, slot in
            guard let aid = athleteId(teamId: teamId, week: week, slot: slot) else { return sum }
            return sum + points(aid, week: week)
        }
        return (total * 100).rounded() / 100
    }

    // Ownership

    func owner(of athleteId: String) -> Team? {
        teams.first { $0.roster.contains(athleteId) }
    }

    func availability(_ athleteId: String) -> Availability {
        if let owner = owner(of: athleteId) { return .owned(owner.id) }
        if let until = waivers[athleteId] { return .waivers(until) }
        return .freeAgent
    }

    var pendingClaims: [WaiverClaim] { claims.filter { $0.status == "pending" } }

    var incomingTrades: [Trade] { trades.filter { $0.status == "pending" && $0.toId == me } }

    func reviewNeedsMe(_ trade: Trade) -> Bool {
        guard trade.status == "review", trade.fromId != me, trade.toId != me else { return false }
        if settings.tradeReview == "commish" { return isCommissioner }
        return settings.tradeReview == "league" && !trade.vetoes.contains(me)
    }

    var tradeBadgeCount: Int {
        incomingTrades.count + trades.filter { reviewNeedsMe($0) }.count
    }

    /// Simple logistic win probability from the current score gap.
    static func winProbability(my: Double, opp: Double, final: Bool) -> Double {
        if final { return my > opp ? 1 : my < opp ? 0 : 0.5 }
        return 1 / (1 + exp(-(my - opp) / 18))
    }

    // Live Activity

    static func liveActivityId(leagueId: String, week: Int, teamId: String) -> String {
        "m-\(leagueId.prefix(8))-\(week)-\(teamId.prefix(12))"
    }

    func liveContent(teamId: String, week: Int, athletes: [String: Athlete], projections: WeekProjections? = nil) -> MatchupAttributes.ContentState {
        let m = matchup(for: teamId, week: week)
        let oppId = m?.opponent(of: teamId)
        let mine = weekScore(teamId, week: week)
        let theirs = oppId.map { weekScore($0, week: week) } ?? 0
        var best: (String, Double)?
        for slot in Slot.starters {
            guard let aid = athleteId(teamId: teamId, week: week, slot: slot) else { continue }
            let p = points(aid, week: week)
            if p > 0, p > (best?.1 ?? 0) { best = (athletes[aid]?.firstName ?? "", p) }
        }
        let isFinal = m?.final ?? false
        let detail: String
        if isFinal {
            detail = mine > theirs ? "Victory" : mine < theirs ? "Defeat" : "Tie"
        } else {
            detail = mine > theirs ? "Up \(Fmt.short(mine - theirs))" : mine < theirs ? "Down \(Fmt.short(theirs - mine))" : "Tied"
        }
        // Projected finals: live score + what's still to come (display only, never scoring).
        let proj = projections?.week == week ? projections : nil
        let myProj: Double? = isFinal ? mine : proj?.teams[teamId].map { mine + $0.projected }
        let oppProj: Double? = isFinal ? theirs : oppId.flatMap { id in proj?.teams[id].map { theirs + $0.projected } }
        return MatchupAttributes.ContentState(
            myScore: mine,
            oppScore: theirs,
            myLeader: best.map { "\($0.0) \(Fmt.short($0.1))" } ?? "No points yet",
            status: isFinal ? "FINAL" : "LIVE",
            detail: detail,
            myProj: myProj,
            oppProj: oppProj,
            leagueName: name
        )
    }
}
